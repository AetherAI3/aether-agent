import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext } from "../src/core/context.js";
import type { McpClient } from "../src/core/mcp.js";
import { LocalMcpStore } from "../src/core/mcp_store.js";
import type { RunResult, Runner } from "../src/core/worktree.js";
import type { StreamFrame } from "../src/core/stream.js";
import type { HealthCheck, HealthReport } from "../src/core/health.js";
import {
  agentUnproven,
  branchFreshness,
  branchProbe,
  custodyProbe,
  githubProbe,
  liveReport,
  openerProbe,
  pickDoctorSafeTool,
  seqIsMonotonic,
  spendCheck,
  SpendLedger,
  type LiveOptions,
} from "../src/core/doctor_live.js";

const RUN_ID = "0198f4c2-0000-4000-8000-000000000001";
const LOCAL = "a".repeat(40);
const REMOTE = "b".repeat(40);

function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "aether-live-"));
}

function find(report: HealthReport, id: string): HealthCheck {
  const check = report.checks.find((entry) => entry.id === id);
  assert.ok(check, `no check with id ${id}`);
  return check;
}

/** A Runner that answers from a table keyed by the argv it receives. */
function fakeRunner(table: Record<string, Partial<RunResult>>): Runner {
  return (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    for (const [pattern, result] of Object.entries(table)) {
      if (key.includes(pattern)) return { status: 0, stdout: "", stderr: "", ...result };
    }
    return { status: 1, stdout: "", stderr: "no match" };
  };
}

function sseBytes(frames: readonly StreamFrame[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const frame of frames) {
        yield encoder.encode(`data: ${JSON.stringify(frame)}\n\n`);
      }
    },
  };
}

interface FakeServer {
  created?: Record<string, unknown>;
  frames?: StreamFrame[];
  controlFails?: boolean;
  closeFails?: boolean;
  catalog?: unknown;
}

interface Recorded {
  ctx: AppContext;
  posts: Array<{ path: string; body: unknown }>;
  deletes: string[];
}

function fakeCtx(server: FakeServer = {}, cwd = process.cwd()): Recorded {
  const posts: Array<{ path: string; body: unknown }> = [];
  const deletes: string[] = [];
  const ctx = {
    cfg: { baseUrl: "https://api.example.invalid" },
    flags: { cwd, json: false, audit: false, yes: false },
    tokens: { get: async (): Promise<string | null> => "SYNTHETIC-TOKEN" },
    api: {
      async getJson(): Promise<unknown> {
        return server.catalog ?? {
          models: [{ id: "sonnet", kind: "model", available: true }],
          tier: "pro",
          default: "sonnet",
        };
      },
      async postJson(path: string, body: unknown): Promise<unknown> {
        posts.push({ path, body });
        if (path.endsWith("/control")) {
          if (server.controlFails) throw new Error("control refused");
          return { ok: true };
        }
        if (path.endsWith("/tool-results")) return { ok: true };
        return server.created ?? { session_id: "sess-0198f4c2" };
      },
      async deleteJson(path: string): Promise<unknown> {
        deletes.push(path);
        if (server.closeFails) throw new Error("close refused");
        return {};
      },
      async stream(): Promise<AsyncIterable<Uint8Array>> {
        return sseBytes(server.frames ?? []);
      },
    },
    confirm: async (): Promise<boolean> => false,
  } as unknown as AppContext;
  return { ctx, posts, deletes };
}

const HAPPY_FRAMES: StreamFrame[] = [
  { type: "session", seq: 1, sessionId: "sess-0198f4c2", protocolVersion: 1 },
  { type: "tool_call", seq: 2, toolCallId: "tc-1", name: "read_file", args: {} },
  { type: "tool_result_ack", seq: 3, toolCallId: "tc-1" },
  { type: "done", seq: 4, uvt: 0, cents: 0, ok: true },
];

function emptyStore(): LocalMcpStore {
  return new LocalMcpStore(join(mkdtempSync(join(tmpdir(), "aether-live-mcp-")), "mcp.json"));
}

function deadClient(): McpClient {
  const fail = async (): Promise<never> => {
    throw new Error("broker unavailable");
  };
  return { listProviders: fail, listConnections: fail, listTools: fail } as unknown as McpClient;
}

function liveOpts(over: Partial<LiveOptions> = {}): LiveOptions {
  return {
    runId: RUN_ID,
    timeoutMs: 2_000,
    skipOpenerProbe: true,
    mcpClient: deadClient(),
    mcpStore: emptyStore(),
    runner: fakeRunner({}),
    ...over,
  };
}

// ── pure helpers ────────────────────────────────────────────────────

test("frame sequence must be strictly increasing", () => {
  assert.equal(seqIsMonotonic([1, 2, 3]), true);
  assert.equal(seqIsMonotonic([1]), true);
  assert.equal(seqIsMonotonic([]), true);
  assert.equal(seqIsMonotonic([1, 1]), false, "a replayed seq is not progress");
  assert.equal(seqIsMonotonic([3, 2]), false);
});

test("only a tool that declares itself readOnly AND doctorSafe may be called", () => {
  assert.equal(pickDoctorSafeTool([{ name: "search" }]), null);
  assert.equal(pickDoctorSafeTool([{ name: "search", readOnly: true }]), null);
  assert.equal(pickDoctorSafeTool([{ name: "wipe", doctorSafe: true }]), null);
  assert.equal(pickDoctorSafeTool([{ name: "ping", readOnly: true, doctorSafe: true }]), "ping");
});

test("every agent probe reports not-checked when the loop cannot be proven", () => {
  const checks = agentUnproven("server said no");
  assert.equal(checks.length, 5);
  for (const check of checks) {
    assert.equal(check.verified.state, "not-checked", `${check.id} must not claim a pass`);
    assert.equal(check.reachable.state, "not-checked");
    assert.match(String(check.verified.evidence), /server said no/);
    assert.match(String(check.remediation), /non-billable doctor session/);
  }
});

// ── branch freshness (no fetch) ─────────────────────────────────────

test("branch freshness classifies every state without fetching", () => {
  const base = {
    "rev-parse --abbrev-ref HEAD": { stdout: "main\n" },
    "rev-parse HEAD": { stdout: `${LOCAL}\n` },
  };
  const at = (over: Record<string, Partial<RunResult>>): string =>
    branchFreshness(fakeRunner({ ...base, ...over }), ".").state;

  assert.equal(at({ "ls-remote": { stdout: `${LOCAL}\trefs/heads/main\n` } }), "current");
  assert.equal(at({ "ls-remote": { stdout: "" } }), "unpublished");
  assert.equal(at({ "ls-remote": { status: 1 } }), "unknown");
  // origin's tip is not in the local object store — say so, never fetch to find out.
  assert.equal(
    at({ "ls-remote": { stdout: `${REMOTE}\trefs/heads/main\n` }, "cat-file": { status: 1 } }),
    "unknown",
  );
  assert.equal(
    at({
      "ls-remote": { stdout: `${REMOTE}\trefs/heads/main\n` },
      "cat-file": { status: 0 },
      [`merge-base --is-ancestor ${REMOTE} ${LOCAL}`]: { status: 0 },
    }),
    "ahead",
  );
  assert.equal(
    at({
      "ls-remote": { stdout: `${REMOTE}\trefs/heads/main\n` },
      "cat-file": { status: 0 },
      [`merge-base --is-ancestor ${LOCAL} ${REMOTE}`]: { status: 0 },
    }),
    "behind",
  );
  assert.equal(
    at({ "ls-remote": { stdout: `${REMOTE}\trefs/heads/main\n` }, "cat-file": { status: 0 } }),
    "diverged",
  );
  assert.equal(
    branchFreshness(fakeRunner({ "rev-parse --abbrev-ref HEAD": { stdout: "HEAD\n" } }), ".").state,
    "detached",
  );
  assert.equal(branchFreshness(fakeRunner({}), ".").state, "unknown");
});

test("the branch comparison never runs a mutating git command", () => {
  const seen: string[] = [];
  const runner: Runner = (cmd, args) => {
    seen.push([cmd, ...args].join(" "));
    if (args.includes("--abbrev-ref")) return { status: 0, stdout: "main\n", stderr: "" };
    if (args.includes("ls-remote")) {
      return { status: 0, stdout: `${LOCAL}\trefs/heads/main\n`, stderr: "" };
    }
    return { status: 0, stdout: `${LOCAL}\n`, stderr: "" };
  };
  branchProbe(runner, ".");
  const forbidden = /\b(fetch|pull|push|merge|rebase|reset|checkout|clean|commit)\b/;
  for (const command of seen) {
    assert.equal(forbidden.test(command), false, `mutating git command: ${command}`);
  }
});

// ── gh identity ─────────────────────────────────────────────────────

test("github identity reports the login, and a missing gh is a warning not a failure", () => {
  const authed = githubProbe(
    fakeRunner({ "gh auth status": { stdout: "Logged in to github.com account synthetic-user" } }),
  );
  assert.equal(authed.verified.state, "yes");
  assert.match(String(authed.verified.evidence), /synthetic-user/);

  const missing = githubProbe(fakeRunner({}));
  assert.equal(missing.verified.state, "no");
  assert.equal(missing.severity, "warning");
  assert.match(String(missing.remediation), /gh auth login/);
});

// ── custody receipt round trip ──────────────────────────────────────

test("the receipt round trip persists, reads back, and de-duplicates a replay", () => {
  const dir = sandbox();
  const check = custodyProbe(dir, RUN_ID);
  assert.equal(check.verified.state, "yes");
  assert.match(String(check.verified.evidence), /de-duplicated/);
  assert.ok(existsSync(join(dir, "custody.jsonl")));
});

test("the receipt proof writes only inside its sandbox", () => {
  const dir = sandbox();
  custodyProbe(dir, RUN_ID);
  assert.deepEqual(readdirSync(dir), ["custody.jsonl"]);
});

// ── spend ledger ────────────────────────────────────────────────────

test("the ledger records billed frames and unclosed sessions", () => {
  const clean = new SpendLedger();
  clean.sessionOpened();
  clean.observe({ type: "done", seq: 1, uvt: 0, cents: 0, ok: true });
  clean.sessionClosed();
  assert.equal(clean.spent, false);
  assert.equal(clean.orphaned, 0);
  assert.equal(spendCheck(clean).verified.state, "yes");

  const billed = new SpendLedger();
  billed.observe({ type: "usage", seq: 1, uvt: 12, cents: 3 });
  assert.equal(billed.spent, true);
  const check = spendCheck(billed);
  assert.equal(check.verified.state, "no");
  assert.equal(check.severity, "error");
  assert.match(String(check.verified.evidence), /this run was billed/);

  const orphan = new SpendLedger();
  orphan.sessionOpened();
  assert.equal(orphan.orphaned, 1);
  assert.equal(spendCheck(orphan).severity, "error");
});

// ── opener ──────────────────────────────────────────────────────────

test("a headless session reports the opener skipped, never verified", async () => {
  const check = await openerProbe({ headless: true });
  assert.equal(check.verified.state, "not-checked");
  assert.match(String(check.verified.evidence), /headless/);
});

test("the opener proof passes only when the opened page calls back", async () => {
  // Stand in for a browser: load the page, then run what its script would run.
  // Fetching the page alone is deliberately NOT enough — the callback is the
  // evidence that something actually rendered.
  const browser = (_file: string, args: string[]): unknown => {
    void (async () => {
      const target = new URL(args[0]!);
      await fetch(target.href).catch(() => {});
      const nonce = target.searchParams.get("nonce");
      await fetch(new URL(`/cb?nonce=${nonce}`, target.origin).href).catch(() => {});
    })();
    return { on: (): void => {}, unref: (): void => {} };
  };

  const verified = await openerProbe({
    openerTimeoutMs: 5_000,
    openerOptions: {
      platform: "linux",
      env: { DISPLAY: ":0" } as NodeJS.ProcessEnv,
      spawnFn: browser as never,
    },
  });
  assert.equal(verified.verified.state, "yes");
  assert.match(String(verified.verified.evidence), /called back on loopback/);

  // A process that spawns but renders nothing is not a pass.
  const silent = await openerProbe({
    openerTimeoutMs: 300,
    openerOptions: {
      platform: "linux",
      env: { DISPLAY: ":0" } as NodeJS.ProcessEnv,
      spawnFn: (() => ({ on: (): void => {}, unref: (): void => {} })) as never,
    },
  });
  assert.equal(silent.verified.state, "no");
  assert.match(String(silent.verified.evidence), /nothing rendered/);
});

// ── full live run ───────────────────────────────────────────────────

test("a server that will not confirm a non-billable session is closed, not driven", async () => {
  // No purpose/billable echo — the old server. Nothing may be spent.
  const { ctx, posts, deletes } = fakeCtx({ created: { session_id: "sess-legacy" } });
  const report = await liveReport(ctx, liveOpts());

  assert.equal(report.mode, "live");
  for (const id of ["agent.frames", "agent.session.control", "agent.tool.roundtrip"]) {
    assert.equal(find(report, id).verified.state, "not-checked");
  }
  assert.match(
    String(find(report, "agent.session").verified.evidence),
    /non-billable doctor session/,
  );
  assert.equal(deletes.length, 1, "the unconfirmed session was closed immediately");
  assert.equal(
    posts.some((p) => p.path.endsWith("/control")),
    false,
    "no control was issued",
  );
  assert.equal(find(report, "spend.none").verified.state, "yes");
});

test("the create request carries the doctor purpose and a zero spend ceiling", async () => {
  const { ctx, posts } = fakeCtx({ created: { session_id: "sess-legacy" } });
  await liveReport(ctx, liveOpts());
  const create = posts.find((p) => p.path === "/agent/dev/sessions");
  assert.ok(create);
  const body = create.body as Record<string, unknown>;
  assert.equal(body["purpose"], "doctor");
  assert.equal(body["max_uvt"], 0);
});

test("the live catalogue probe accepts the production envelope and legacy array", async () => {
  for (const catalog of [
    { models: [{ id: "sonnet", kind: "model", available: true }], tier: "pro", default: "sonnet" },
    [{ id: "sonnet", kind: "model", available: true }],
  ]) {
    const { ctx } = fakeCtx({ catalog });
    const report = await liveReport(ctx, liveOpts());
    const result = find(report, "agent.catalog");
    assert.equal(result.verified.state, "yes");
    assert.match(String(result.verified.evidence), /1 catalog item\(s\), 1 available/);
  }
});

test("the live catalogue probe names an invalid envelope instead of inventing zero models", async () => {
  const { ctx } = fakeCtx({ catalog: { tier: "pro", default: "sonnet" } });
  const report = await liveReport(ctx, liveOpts());
  const result = find(report, "agent.catalog");
  assert.equal(result.verified.state, "no");
  assert.equal(result.severity, "error");
  assert.match(String(result.verified.evidence), /invalid \/models response shape/);
  assert.doesNotMatch(String(result.verified.evidence), /0 catalog item/);
});

test("a confirmed doctor session proves frames, control and the tool round trip", async () => {
  const { ctx, posts, deletes } = fakeCtx({
    created: { session_id: "sess-0198f4c2", purpose: "doctor", billable: false },
    frames: HAPPY_FRAMES,
  });
  const report = await liveReport(ctx, liveOpts());

  assert.equal(find(report, "agent.session").verified.state, "yes");
  assert.equal(find(report, "agent.frames").verified.state, "yes");
  assert.match(String(find(report, "agent.frames").verified.evidence), /seq 1\.\.4/);
  assert.equal(find(report, "agent.session.control").verified.state, "yes");
  assert.equal(find(report, "agent.tool.roundtrip").verified.state, "yes");
  assert.equal(find(report, "agent.session.close").verified.state, "yes");
  assert.equal(find(report, "spend.none").verified.state, "yes");

  // pause, then resume, then steer — in that order, with the run nonce.
  const control = posts
    .filter((p) => p.path.endsWith("/control"))
    .map((p) => p.body as Record<string, unknown>);
  assert.deepEqual(
    control.map((c) => c["action"]),
    ["pause", "resume", "steer"],
  );
  assert.equal(control[2]?.["note"], `doctor-${RUN_ID}`);
  assert.equal(deletes.length, 1);
});

test("a session the server bills is reported as an error, not a footnote", async () => {
  const { ctx } = fakeCtx({
    created: { session_id: "sess-0198f4c2", purpose: "doctor", billable: false },
    frames: [
      { type: "session", seq: 1, sessionId: "sess-0198f4c2", protocolVersion: 1 },
      { type: "done", seq: 2, uvt: 42, cents: 7, ok: true },
    ],
  });
  const report = await liveReport(ctx, liveOpts());
  const spend = find(report, "spend.none");
  assert.equal(spend.verified.state, "no");
  assert.equal(spend.severity, "error");
  assert.match(String(spend.verified.evidence), /this run was billed/);
});

test("an out-of-order frame fails the sequence proof", async () => {
  const { ctx } = fakeCtx({
    created: { session_id: "sess-0198f4c2", purpose: "doctor", billable: false },
    frames: [
      { type: "session", seq: 5, sessionId: "sess-0198f4c2", protocolVersion: 1 },
      { type: "done", seq: 2, uvt: 0, cents: 0, ok: true },
    ],
  });
  const report = await liveReport(ctx, liveOpts());
  assert.equal(find(report, "agent.frames").verified.state, "no");
  assert.equal(find(report, "agent.frames").severity, "error");
});

test("an unacknowledged control action fails the control proof", async () => {
  const { ctx } = fakeCtx({
    created: { session_id: "sess-0198f4c2", purpose: "doctor", billable: false },
    frames: HAPPY_FRAMES,
    controlFails: true,
  });
  const report = await liveReport(ctx, liveOpts());
  const control = find(report, "agent.session.control");
  assert.equal(control.verified.state, "no");
  assert.match(String(control.verified.evidence), /pause unacked/);
});

test("a session that will not close is an orphan, and says so", async () => {
  const { ctx } = fakeCtx({
    created: { session_id: "sess-0198f4c2", purpose: "doctor", billable: false },
    frames: HAPPY_FRAMES,
    closeFails: true,
  });
  const report = await liveReport(ctx, liveOpts());
  assert.equal(find(report, "agent.session.close").verified.state, "no");
  const spend = find(report, "spend.none");
  assert.equal(spend.verified.state, "no");
  assert.match(String(spend.verified.evidence), /session\(s\) left open/);
});

test("a broker with no doctor-safe tool is reachable but unproven", async () => {
  const client = {
    listProviders: async () => [{ provider_id: "docs", display_name: "Docs", flow: "pat_paste" }],
    listConnections: async () => [{ provider_id: "docs", created_at: "t", updated_at: "t" }],
    listTools: async () => [{ name: "search" }],
  } as unknown as McpClient;
  const { ctx } = fakeCtx({ created: { session_id: "s" } });
  const report = await liveReport(ctx, liveOpts({ mcpClient: client }));
  const mcp = find(report, "mcp.broker");
  assert.equal(mcp.reachable.state, "yes");
  assert.equal(mcp.verified.state, "not-checked");
  assert.match(String(mcp.verified.evidence), /readOnly \+ doctorSafe/);
});

test("signed out means the agent loop is unproven, not failed", async () => {
  const { ctx, posts } = fakeCtx();
  (ctx as unknown as { tokens: { get: () => Promise<string | null> } }).tokens = {
    get: async () => null,
  };
  const report = await liveReport(ctx, liveOpts());
  assert.equal(find(report, "auth.credential").verified.state, "no");
  assert.equal(find(report, "agent.session").verified.state, "not-checked");
  assert.equal(
    posts.some((p) => p.path === "/agent/dev/sessions"),
    false,
    "no session was created",
  );
});

test("a live run leaves no doctor sandbox behind", async () => {
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith("aether-doctor-")).length;
  const { ctx } = fakeCtx({
    created: { session_id: "sess-0198f4c2", purpose: "doctor", billable: false },
    frames: HAPPY_FRAMES,
  });
  await liveReport(ctx, liveOpts());
  const after = readdirSync(tmpdir()).filter((n) => n.startsWith("aether-doctor-")).length;
  assert.ok(after <= before, "the doctor sandbox was not cleaned up");
});

test("a live report never leaks the stored credential", async () => {
  const { ctx } = fakeCtx({
    created: { session_id: "sess-0198f4c2", purpose: "doctor", billable: false },
    frames: HAPPY_FRAMES,
  });
  const report = await liveReport(ctx, liveOpts());
  assert.equal(JSON.stringify(report).includes("SYNTHETIC-TOKEN"), false);
});
