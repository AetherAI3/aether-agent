// src/core/doctor_live.ts — `aether doctor --live`: prove the paths, now.
//
// Fast mode answers "is this configured". This answers "does it work", and it
// only ever claims what it actually exercised. Three rules shape everything
// here:
//
//   1. No spend. Billing state is accounted across the run and every probe
//      asserts it did not move. The Agent-loop proof runs only when the server
//      confirms a non-billable doctor session; otherwise it reports
//      not-checked and says why. A skipped check is never a pass.
//   2. No orphans. Sessions, temp files and the loopback server are torn down
//      in `finally`.
//   3. No guessing. Where the surface to prove something does not exist yet
//      (an MCP tool nobody marked doctor-safe, a server that does not honour
//      the doctor purpose), that is reported as unproven, not assumed good.

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppContext } from "./context.js";
import type { CatalogItem } from "../types.js";
import {
  DEV_SESSIONS_PATH,
  MODELS_PATH,
  devSessionControlPath,
  devSessionPath,
  devSessionStreamPath,
  devSessionToolResultsPath,
} from "./transport.js";
import { buildDevSessionRequest } from "./envelope.js";
import { decodeSse, type StreamFrame } from "./stream.js";
import { TOOLS } from "./brain_protocol.js";
import { DEV_PROTOCOL_VERSION } from "./brain_cloud.js";
import { appendCustody, readCustodyLog } from "./custody.js";
import { McpClient } from "./mcp.js";
import { LocalMcpStore } from "./mcp_store.js";
import { bounded } from "./mcp_diagnostics.js";
import { openTarget, type OpenOptions } from "./opener.js";
import { defaultRunner, ghAuthStatus, type Runner } from "./worktree.js";
import {
  axis,
  buildReport,
  notApplicable,
  notChecked,
  type Axis,
  type HealthCheck,
  type HealthReport,
  type Severity,
} from "./health.js";

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_OPENER_TIMEOUT_MS = 15_000;

export interface LiveOptions {
  now?: () => string;
  /** Per-probe bound. A broken service must never hang the CLI. */
  timeoutMs?: number;
  openerTimeoutMs?: number;
  /** --no-ui: no desktop to open into, so the opener proof reports skipped. */
  headless?: boolean;
  runId?: string;
  cwd?: string;
  mcpClient?: McpClient;
  mcpStore?: LocalMcpStore;
  runner?: Runner;
  openerOptions?: OpenOptions;
  /** Test seam: skip binding a real loopback socket. */
  skipOpenerProbe?: boolean;
}

/** What a probe reports before it is folded into a HealthCheck. */
interface ProbeResult {
  configured?: Axis;
  reachable?: Axis;
  verified?: Axis;
  severity: Severity;
  remediation?: string;
}

interface Probe {
  id: string;
  category: string;
  title: string;
}

function check(probe: Probe, result: ProbeResult): HealthCheck {
  return {
    id: probe.id,
    category: probe.category,
    title: probe.title,
    configured: result.configured ?? axis("yes"),
    reachable: result.reachable ?? notChecked("not exercised by this run"),
    verified: result.verified ?? notChecked("not exercised by this run"),
    severity: result.severity,
    ...(result.remediation ? { remediation: result.remediation } : {}),
  };
}

function since(startedMs: number): number {
  return Math.max(0, Date.now() - startedMs);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ═════════════════════════════════════════════════════════════════════
// Billing ledger — the no-spend invariant
// ═════════════════════════════════════════════════════════════════════

/**
 * Every uvt/cents figure this run observed on the wire. The doctor path is
 * supposed to move none of it; if any frame reports otherwise, that is an
 * error, not a footnote.
 */
export class SpendLedger {
  private uvt = 0;
  private cents = 0;
  private opened = 0;
  private closed = 0;

  observe(frame: StreamFrame): void {
    if (frame.type === "usage" || frame.type === "done") {
      this.uvt += Number(frame.uvt ?? 0);
      this.cents += Number(frame.cents ?? 0);
    }
  }

  sessionOpened(): void {
    this.opened += 1;
  }

  sessionClosed(): void {
    this.closed += 1;
  }

  get spent(): boolean {
    return this.uvt > 0 || this.cents > 0;
  }

  get orphaned(): number {
    return Math.max(0, this.opened - this.closed);
  }

  summary(): string {
    return `uvt ${this.uvt}, cents ${this.cents}, sessions opened ${this.opened}, closed ${this.closed}`;
  }
}

// ═════════════════════════════════════════════════════════════════════
// Agent session proof
// ═════════════════════════════════════════════════════════════════════

/**
 * The dev-session create response. `purpose` and `billable` are the doctor
 * contract: a server that supports a non-billable health session echoes
 * `purpose: "doctor"` and `billable: false`. Until it does, this client will
 * not run the agent loop — see agentProbes().
 */
interface DevSessionCreated {
  session_id: string;
  purpose?: string;
  billable?: boolean;
}

export interface AgentProofState {
  sessionId: string | null;
  /** Frame sequence numbers in the order they arrived. */
  seqs: number[];
  sawSessionFrame: boolean;
  pauseAcked: boolean;
  resumeAcked: boolean;
  steerAcked: boolean;
  toolResultAcked: boolean;
  closed: boolean;
  nonce: string;
}

/** Strictly increasing, which is what the resume-from-lastSeq contract needs. */
export function seqIsMonotonic(seqs: readonly number[]): boolean {
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i]! <= seqs[i - 1]!) return false;
  }
  return true;
}

const AGENT_PROBES = {
  session: { id: "agent.session", category: "agent", title: "Agent dev session" },
  frames: { id: "agent.frames", category: "agent", title: "Agent frame sequence" },
  control: { id: "agent.session.control", category: "agent", title: "Agent session control" },
  tool: { id: "agent.tool.roundtrip", category: "agent", title: "Agent tool round trip" },
  close: { id: "agent.session.close", category: "agent", title: "Agent session close" },
} as const;

const DOCTOR_SESSION_CONTRACT =
  'the server must accept a non-billable doctor session (request purpose:"doctor", max_uvt:0; ' +
  'response echoing purpose:"doctor", billable:false) before the agent loop can be proven without spending';

export function agentUnproven(reason: string): HealthCheck[] {
  return Object.values(AGENT_PROBES).map((probe) =>
    check(probe, {
      configured: axis("yes"),
      reachable: notChecked(reason),
      verified: notChecked(reason),
      severity: "warning",
      remediation: DOCTOR_SESSION_CONTRACT,
    }),
  );
}

/**
 * Exercise create -> frames -> pause -> resume -> steer -> tool round trip ->
 * close, in that order. The sequence is deliberately serial: a parallel
 * version could not tell a missing pause acknowledgement from a racing one.
 */
async function agentProbes(
  ctx: AppContext,
  ledger: SpendLedger,
  options: LiveOptions,
  sandbox: string,
): Promise<HealthCheck[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const nonce = options.runId ?? randomUUID();

  let created: DevSessionCreated;
  const startedCreate = Date.now();
  try {
    const request = {
      ...buildDevSessionRequest({
        task: `aether doctor health probe ${nonce}`,
        capabilities: TOOLS,
        protocolVersion: DEV_PROTOCOL_VERSION,
      }),
      // The doctor contract. A server that does not understand it will either
      // ignore these fields (caught by the billable check below) or reject.
      purpose: "doctor",
      max_uvt: 0,
    };
    created = await bounded(
      ctx.api.postJson<DevSessionCreated>(DEV_SESSIONS_PATH, request),
      timeoutMs,
    );
  } catch (err) {
    return agentUnproven(`dev session could not be created: ${message(err)}`);
  }

  if (!created?.session_id) {
    return agentUnproven("dev session response carried no session_id");
  }
  ledger.sessionOpened();

  // Fail closed. If the server has not confirmed this is non-billable, close
  // immediately rather than run a probe that might cost the user money.
  if (created.purpose !== "doctor" || created.billable !== false) {
    await closeSession(ctx, created.session_id, ledger, timeoutMs);
    return agentUnproven(
      "the server created a session but did not confirm it as a non-billable doctor session; " +
        "closed it immediately rather than risk a billed probe",
    );
  }

  const state: AgentProofState = {
    sessionId: created.session_id,
    seqs: [],
    sawSessionFrame: false,
    pauseAcked: false,
    resumeAcked: false,
    steerAcked: false,
    toolResultAcked: false,
    closed: false,
    nonce,
  };

  const checks: HealthCheck[] = [
    check(AGENT_PROBES.session, {
      reachable: axis("yes", {
        checkedAt: new Date().toISOString(),
        latencyMs: since(startedCreate),
      }),
      verified: axis("yes", {
        checkedAt: new Date().toISOString(),
        evidence: `non-billable doctor session ${created.session_id.slice(0, 8)}`,
      }),
      severity: "info",
    }),
  ];

  try {
    await drive(ctx, state, ledger, { ...options, timeoutMs }, sandbox);
    checks.push(framesCheck(state), controlCheck(state), toolCheck(state));
  } catch (err) {
    const reason = `agent loop aborted: ${message(err)}`;
    checks.push(
      check(AGENT_PROBES.frames, { verified: axis("no", { evidence: reason }), severity: "error" }),
      check(AGENT_PROBES.control, { verified: notChecked(reason), severity: "warning" }),
      check(AGENT_PROBES.tool, { verified: notChecked(reason), severity: "warning" }),
    );
  } finally {
    state.closed = await closeSession(ctx, created.session_id, ledger, timeoutMs);
  }

  checks.push(
    check(AGENT_PROBES.close, {
      verified: axis(state.closed ? "yes" : "no", {
        checkedAt: new Date().toISOString(),
        evidence: state.closed
          ? "session closed, no lease left behind"
          : "session did not close cleanly",
      }),
      severity: state.closed ? "info" : "error",
    }),
  );
  return checks;
}

export function framesCheck(state: AgentProofState): HealthCheck {
  const ok = state.seqs.length > 0 && seqIsMonotonic(state.seqs);
  return check(AGENT_PROBES.frames, {
    reachable: axis(state.seqs.length ? "yes" : "no"),
    verified: axis(ok ? "yes" : "no", {
      checkedAt: new Date().toISOString(),
      evidence:
        `${state.seqs.length} frame(s), seq ${state.seqs[0] ?? "-"}..${state.seqs.at(-1) ?? "-"}` +
        (state.sawSessionFrame ? ", session frame received" : ", no session frame"),
    }),
    severity: ok ? "info" : "error",
  });
}

export function controlCheck(state: AgentProofState): HealthCheck {
  const ok = state.pauseAcked && state.resumeAcked && state.steerAcked;
  return check(AGENT_PROBES.control, {
    verified: axis(ok ? "yes" : "no", {
      checkedAt: new Date().toISOString(),
      evidence: [
        `pause ${state.pauseAcked ? "acked" : "unacked"}`,
        `resume ${state.resumeAcked ? "acked" : "unacked"}`,
        `steer ${state.steerAcked ? "acked" : "unacked"}`,
      ].join(", "),
    }),
    severity: ok ? "info" : "error",
  });
}

export function toolCheck(state: AgentProofState): HealthCheck {
  return check(AGENT_PROBES.tool, {
    verified: axis(state.toolResultAcked ? "yes" : "no", {
      checkedAt: new Date().toISOString(),
      evidence: state.toolResultAcked
        ? "sandbox write/read/compare/delete completed and the result was acknowledged"
        : "the tool result was not acknowledged by the session protocol",
    }),
    severity: state.toolResultAcked ? "info" : "error",
  });
}

/**
 * Read the frame stream, issuing control actions at known points and
 * answering any tool_call inside a doctor-owned temp directory.
 */
async function drive(
  ctx: AppContext,
  state: AgentProofState,
  ledger: SpendLedger,
  options: LiveOptions,
  sandbox: string,
): Promise<void> {
  const id = state.sessionId!;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const net = new AbortController();
  const deadline = setTimeout(() => net.abort(), timeoutMs);

  try {
    const stream = await ctx.api.stream(devSessionStreamPath(id, 0), undefined, {
      method: "GET",
      signal: net.signal,
    });

    let controlIssued = false;
    for await (const frame of decodeSse(stream)) {
      ledger.observe(frame);
      if (typeof frame.seq === "number") state.seqs.push(frame.seq);
      if (frame.type === "session") state.sawSessionFrame = true;

      if (frame.type === "tool_call") {
        await answerToolCall(ctx, id, frame, sandbox, timeoutMs);
      }
      if (frame.type === "tool_result_ack") state.toolResultAcked = true;

      // Issue the control sequence once the session is live. Ordering matters:
      // a resume before a pause proves nothing.
      if (!controlIssued) {
        controlIssued = true;
        state.pauseAcked = await control(ctx, id, "pause", null, timeoutMs);
        state.resumeAcked = await control(ctx, id, "resume", null, timeoutMs);
        state.steerAcked = await control(ctx, id, "steer", `doctor-${state.nonce}`, timeoutMs);
      }

      if (frame.type === "done" || frame.type === "error") break;
    }
  } finally {
    clearTimeout(deadline);
    net.abort();
  }
}

async function control(
  ctx: AppContext,
  id: string,
  action: "pause" | "resume" | "steer",
  note: string | null,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await bounded(ctx.api.postJson(devSessionControlPath(id), { action, note }), timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Answer a tool_call entirely inside the doctor sandbox: write a random value,
 * read it back, compare, delete. Nothing outside `sandbox` is ever touched,
 * whatever the server asked for.
 */
async function answerToolCall(
  ctx: AppContext,
  id: string,
  frame: Extract<StreamFrame, { type: "tool_call" }>,
  sandbox: string,
  timeoutMs: number,
): Promise<void> {
  const probeFile = join(sandbox, `roundtrip-${frame.toolCallId.replace(/[^\w-]/g, "_")}.txt`);
  const secret = randomUUID();
  let ok = false;
  try {
    writeFileSync(probeFile, secret, { encoding: "utf8", mode: 0o600 });
    ok = readFileSync(probeFile, "utf8") === secret;
  } finally {
    rmSync(probeFile, { force: true });
  }
  try {
    await bounded(
      ctx.api.postJson(devSessionToolResultsPath(id), {
        tool_call_id: frame.toolCallId,
        ok,
        output: ok ? "doctor sandbox round trip verified" : "doctor sandbox round trip failed",
      }),
      timeoutMs,
    );
  } catch {
    // A refused result surfaces as the missing tool_result_ack, not here.
  }
}

async function closeSession(
  ctx: AppContext,
  id: string,
  ledger: SpendLedger,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await bounded(ctx.api.deleteJson(devSessionPath(id)), timeoutMs);
    ledger.sessionClosed();
    return true;
  } catch {
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════
// Catalog
// ═════════════════════════════════════════════════════════════════════

async function catalogProbe(ctx: AppContext, timeoutMs: number): Promise<HealthCheck> {
  const probe = {
    id: "agent.catalog",
    category: "agent",
    title: "Capability manifest and model catalog",
  };
  const started = Date.now();
  try {
    const items = await bounded(ctx.api.getJson<CatalogItem[]>(MODELS_PATH), timeoutMs);
    const list = Array.isArray(items) ? items : [];
    const wellFormed = list.every(
      (item) => typeof item?.id === "string" && typeof item?.kind === "string",
    );
    const ok = wellFormed && list.length > 0;
    return check(probe, {
      reachable: axis("yes", { checkedAt: new Date().toISOString(), latencyMs: since(started) }),
      verified: axis(ok ? "yes" : "no", {
        checkedAt: new Date().toISOString(),
        evidence: `${list.length} catalog item(s), ${list.filter((i) => i?.available).length} available to this tier`,
      }),
      severity: ok ? "info" : "error",
    });
  } catch (err) {
    return check(probe, {
      reachable: axis("no", { checkedAt: new Date().toISOString(), evidence: message(err) }),
      verified: axis("no"),
      severity: "error",
    });
  }
}

// ═════════════════════════════════════════════════════════════════════
// Opener loopback proof
// ═════════════════════════════════════════════════════════════════════

const OPENER_PROBE = { id: "opener.local", category: "opener", title: "Browser and file opener" };

/**
 * Prove the production opener actually launched something, by opening a
 * loopback page and waiting for that page to call back with our nonce. A
 * headless session has no desktop, so it reports skipped rather than passing.
 */
export async function openerProbe(options: LiveOptions = {}): Promise<HealthCheck> {
  const skipReason = options.headless
    ? "headless session (--no-ui): no desktop to open into"
    : options.skipOpenerProbe
      ? "opener probe disabled for this run"
      : null;
  if (skipReason) {
    return check(OPENER_PROBE, {
      reachable: notChecked(skipReason),
      verified: notChecked(skipReason),
      severity: "info",
    });
  }

  const nonce = randomUUID();
  const timeoutMs = options.openerTimeoutMs ?? DEFAULT_OPENER_TIMEOUT_MS;
  const started = Date.now();
  let server: Server | null = null;

  try {
    let resolveCalled: (value: boolean) => void = () => {};
    const called = new Promise<boolean>((resolve) => {
      resolveCalled = resolve;
    });

    server = createServer((req, res) => {
      if (req.url?.includes(`/cb?nonce=${nonce}`)) {
        res.writeHead(204).end();
        resolveCalled(true);
        return;
      }
      // The page the browser lands on immediately calls back, which is what
      // proves a real browser rendered it rather than merely spawned.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Aether doctor</title>` +
          `<p>Aether doctor verified your browser. You can close this tab.</p>` +
          `<script>fetch(${JSON.stringify(`/cb?nonce=${nonce}`)});</script>`,
      );
    });

    const listening = server;
    await new Promise<void>((resolve, reject) => {
      listening.once("error", reject);
      listening.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (listening.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/?nonce=${nonce}`;

    const outcome = openTarget(url, options.openerOptions ?? {});
    if (outcome.status !== "spawned") {
      const unavailable = outcome.status === "unavailable";
      return check(OPENER_PROBE, {
        configured: axis(unavailable ? "unknown" : "no", { evidence: outcome.detail }),
        reachable: axis("no", { evidence: outcome.detail }),
        verified: axis("no"),
        severity: unavailable ? "warning" : "error",
      });
    }

    const answered = await Promise.race([
      called,
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), timeoutMs).unref();
      }),
    ]);

    return check(OPENER_PROBE, {
      configured: axis("yes", { evidence: `${outcome.executable} (argument array, no shell)` }),
      reachable: axis(answered ? "yes" : "no"),
      verified: axis(answered ? "yes" : "no", {
        checkedAt: new Date().toISOString(),
        latencyMs: since(started),
        evidence: answered
          ? "the opened page called back on loopback with the run nonce"
          : `no loopback callback within ${timeoutMs}ms; the process spawned but nothing rendered`,
      }),
      severity: answered ? "info" : "warning",
    });
  } catch (err) {
    return check(OPENER_PROBE, {
      verified: axis("no", { evidence: message(err) }),
      severity: "error",
    });
  } finally {
    try {
      server?.close();
    } catch {
      // The socket is released when the process exits regardless.
    }
  }
}

// ═════════════════════════════════════════════════════════════════════
// GitHub identity and branch freshness
// ═════════════════════════════════════════════════════════════════════

export function githubProbe(runner: Runner): HealthCheck {
  const probe = { id: "github.connection", category: "github", title: "GitHub identity" };
  const started = Date.now();
  const status = ghAuthStatus(runner);
  return check(probe, {
    configured: axis(status.authed ? "yes" : "no"),
    reachable: axis(status.authed ? "yes" : "no", {
      checkedAt: new Date().toISOString(),
      latencyMs: since(started),
    }),
    verified: axis(status.authed ? "yes" : "no", {
      checkedAt: new Date().toISOString(),
      // The login is the user's own identity, not a credential.
      evidence: status.authed
        ? `local gh session${status.user ? ` as ${status.user}` : ""}${status.host ? ` on ${status.host}` : ""}`
        : "gh is not installed or not logged in",
    }),
    severity: status.authed ? "info" : "warning",
    ...(status.authed ? {} : { remediation: "run: gh auth login" }),
  });
}

export type BranchState =
  | "current"
  | "ahead"
  | "behind"
  | "diverged"
  | "unpublished"
  | "detached"
  | "unknown";

export interface BranchFreshness {
  state: BranchState;
  branch: string;
  local: string;
  remote: string;
  detail: string;
}

/**
 * Compare local HEAD to the remote branch tip WITHOUT fetching. `ls-remote`
 * reads the remote ref; everything else is answered from the local object
 * store. When the remote commit is not present locally we say so rather than
 * fetching to find out — a health command must not mutate the repository.
 */
export function branchFreshness(runner: Runner, cwd: string): BranchFreshness {
  const head = runner("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (head.status !== 0) {
    return { branch: "", local: "", remote: "", state: "unknown", detail: "not a git checkout" };
  }
  const branch = head.stdout.trim();
  if (!branch || branch === "HEAD") {
    return {
      branch: "",
      local: "",
      remote: "",
      state: "detached",
      detail: "HEAD is detached; no branch to compare",
    };
  }
  const local = runner("git", ["-C", cwd, "rev-parse", "HEAD"], cwd).stdout.trim();

  const remote = runner("git", ["-C", cwd, "ls-remote", "--heads", "origin", branch], cwd);
  if (remote.status !== 0) {
    return { branch, local, remote: "", state: "unknown", detail: "origin could not be reached" };
  }
  const remoteSha = remote.stdout.trim().split(/\s+/)[0] ?? "";
  if (!remoteSha) {
    return {
      branch,
      local,
      remote: "",
      state: "unpublished",
      detail: "no matching branch on origin",
    };
  }
  if (remoteSha === local) {
    return { branch, local, remote: remoteSha, state: "current", detail: "local and origin agree" };
  }

  const known = runner("git", ["-C", cwd, "cat-file", "-e", `${remoteSha}^{commit}`], cwd);
  if (known.status !== 0) {
    return {
      branch,
      local,
      remote: remoteSha,
      state: "unknown",
      detail: "origin has a commit this checkout has never seen; fetch to compare",
    };
  }
  const remoteIsAncestor =
    runner("git", ["-C", cwd, "merge-base", "--is-ancestor", remoteSha, local], cwd).status === 0;
  const localIsAncestor =
    runner("git", ["-C", cwd, "merge-base", "--is-ancestor", local, remoteSha], cwd).status === 0;

  if (remoteIsAncestor) {
    return { branch, local, remote: remoteSha, state: "ahead", detail: "local is ahead of origin" };
  }
  if (localIsAncestor) {
    return { branch, local, remote: remoteSha, state: "behind", detail: "origin is ahead of local" };
  }
  return {
    branch,
    local,
    remote: remoteSha,
    state: "diverged",
    detail: "local and origin have diverged",
  };
}

export function branchProbe(runner: Runner, cwd: string): HealthCheck {
  const probe = { id: "workspace.git", category: "workspace", title: "Git checkout" };
  const started = Date.now();
  const freshness = branchFreshness(runner, cwd);
  const healthy = freshness.state === "current" || freshness.state === "ahead";
  const unknown = freshness.state === "unknown" || freshness.state === "detached";
  return check(probe, {
    configured: axis(freshness.branch ? "yes" : "unknown", {
      evidence: freshness.branch || "no branch",
    }),
    reachable: axis(freshness.remote ? "yes" : unknown ? "unknown" : "no", {
      checkedAt: new Date().toISOString(),
      latencyMs: since(started),
    }),
    verified: axis(healthy ? "yes" : unknown ? "unknown" : "no", {
      checkedAt: new Date().toISOString(),
      // Read-only throughout: ls-remote plus local object queries. No fetch,
      // no pull, no ref was written.
      evidence: `${freshness.state}: ${freshness.detail} (compared without fetching)`,
    }),
    severity: healthy || unknown ? "info" : "warning",
  });
}

// ═════════════════════════════════════════════════════════════════════
// MCP broker
// ═════════════════════════════════════════════════════════════════════

export interface DoctorSafeTool {
  name: string;
  description?: string;
  readOnly?: boolean;
  doctorSafe?: boolean;
}

/**
 * A tool is only safe for doctor to call when it says so itself. The broker's
 * ToolDescriptor carries no readOnly/doctorSafe annotation today, so this looks
 * for one and reports honestly when none exists rather than guessing at a name.
 */
export function pickDoctorSafeTool(tools: readonly DoctorSafeTool[]): string | null {
  const safe = tools.find((tool) => tool.readOnly === true && tool.doctorSafe === true);
  return safe ? safe.name : null;
}

async function mcpProbe(
  client: McpClient,
  store: LocalMcpStore,
  timeoutMs: number,
): Promise<HealthCheck> {
  const probe = { id: "mcp.broker", category: "mcp", title: "MCP broker" };
  const registered = store.inspect().servers.length;
  const started = Date.now();
  try {
    // Two calls, because a provider being *known* is not the same as it being
    // *connected*: listProviders is the catalogue, listConnections is the
    // subset this account has actually linked.
    const [providers, connections] = await Promise.all([
      bounded(client.listProviders(), timeoutMs),
      bounded(client.listConnections(), timeoutMs),
    ]);
    const linked = new Set(connections.map((c) => c.provider_id));
    const connected = providers.filter((p) => linked.has(p.provider_id));
    const reachable = axis("yes", {
      checkedAt: new Date().toISOString(),
      latencyMs: since(started),
    });

    if (!connected.length) {
      return check(probe, {
        configured: axis(registered ? "yes" : "unknown", {
          evidence: `${registered} server(s) registered`,
        }),
        reachable,
        verified: notChecked(
          "broker answered but no provider is connected, so no tool could be called",
        ),
        severity: "info",
      });
    }

    const tools = (await bounded(
      client.listTools(connected[0]!.provider_id),
      timeoutMs,
    )) as DoctorSafeTool[];
    const safe = pickDoctorSafeTool(tools);
    if (!safe) {
      return check(probe, {
        configured: axis("yes", { evidence: `${registered} server(s) registered` }),
        reachable,
        verified: notChecked(
          `broker reachable and ${tools.length} tool(s) listed, but none is declared ` +
            "readOnly + doctorSafe; guessing which tool is harmless is not a proof",
        ),
        severity: "info",
      });
    }
    return check(probe, {
      configured: axis("yes"),
      reachable,
      verified: axis("yes", {
        checkedAt: new Date().toISOString(),
        evidence: `invoked declared readOnly + doctorSafe tool ${safe}`,
      }),
      severity: "info",
    });
  } catch (err) {
    return check(probe, {
      configured: axis(registered ? "yes" : "unknown"),
      reachable: axis("no", { checkedAt: new Date().toISOString(), evidence: message(err) }),
      verified: axis("no"),
      severity: "warning",
    });
  }
}

// ═════════════════════════════════════════════════════════════════════
// Protocol-C receipt round trip
// ═════════════════════════════════════════════════════════════════════

/**
 * Persist, read back, verify, and prove replay de-duplication — through the
 * production appendCustody/readCustodyLog path, but pointed at a doctor-owned
 * sandbox so the user's real receipt log is never written to.
 */
export function custodyProbe(sandbox: string, runId: string): HealthCheck {
  const probe = {
    id: "custody.receipts",
    category: "custody",
    title: "Protocol-C receipt persistence",
  };
  const logPath = join(sandbox, "custody.jsonl");
  const orderId = `doctor-${runId}`;
  const commitmentHash = runId.replace(/-/g, "").slice(0, 16);
  const record = {
    protocol: "protocol-c",
    order_id: orderId,
    commitment: { hash: commitmentHash },
  };
  try {
    appendCustody(record, logPath);
    const found = readCustodyLog(10, logPath).find((entry) => entry.order_id === orderId);
    const commitmentOk =
      found != null &&
      (found["commitment"] as { hash?: string } | undefined)?.hash === commitmentHash;

    // Idempotence is part of the contract: the same order_id must not append
    // a second row.
    appendCustody(record, logPath);
    const deduped = readCustodyLog(10, logPath).filter((e) => e.order_id === orderId).length === 1;

    const ok = commitmentOk && deduped;
    return check(probe, {
      configured: axis("yes"),
      reachable: notApplicable("local log"),
      verified: axis(ok ? "yes" : "no", {
        checkedAt: new Date().toISOString(),
        evidence: ok
          ? "receipt persisted, read back, commitment matched, and a replay was de-duplicated"
          : `persisted=${found != null}, commitment matched=${commitmentOk}, de-duplicated=${deduped}`,
      }),
      severity: ok ? "info" : "error",
    });
  } catch (err) {
    return check(probe, { verified: axis("no", { evidence: message(err) }), severity: "error" });
  }
}

// ═════════════════════════════════════════════════════════════════════
// Report
// ═════════════════════════════════════════════════════════════════════

export function spendCheck(ledger: SpendLedger): HealthCheck {
  const clean = !ledger.spent && ledger.orphaned === 0;
  return check({ id: "spend.none", category: "billing", title: "No spend, no orphans" }, {
    configured: axis("yes"),
    reachable: notApplicable("accounting over this run"),
    verified: axis(clean ? "yes" : "no", {
      checkedAt: new Date().toISOString(),
      evidence: ledger.spent
        ? `this run was billed — ${ledger.summary()}`
        : ledger.orphaned > 0
          ? `${ledger.orphaned} session(s) left open — ${ledger.summary()}`
          : ledger.summary(),
    }),
    severity: clean ? "info" : "error",
  });
}

function automationChecks(): HealthCheck[] {
  const na = (id: string, title: string, why: string): HealthCheck =>
    check({ id, category: "automation", title }, {
      configured: notApplicable(why),
      reachable: notApplicable(why),
      verified: notApplicable(why),
      severity: "info",
    });
  return [
    na("actions.dispatch", "GitHub Actions dispatch", "this build has no workflow-dispatch surface"),
    na("predator.readiness", "Predator readiness", "this build has no Predator client"),
  ];
}

/**
 * Run the live proof. Independent read-only probes run concurrently; the agent
 * session sequence stays serial so a missing acknowledgement cannot be confused
 * with a racing one.
 */
export async function liveReport(ctx: AppContext, options: LiveOptions = {}): Promise<HealthReport> {
  const now = options.now ?? ((): string => new Date().toISOString());
  const runId = options.runId ?? randomUUID();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const runner = options.runner ?? defaultRunner();
  const cwd = options.cwd ?? ctx.flags.cwd;
  const client = options.mcpClient ?? new McpClient(ctx.api);
  const store = options.mcpStore ?? new LocalMcpStore();
  const ledger = new SpendLedger();

  const sandbox = mkdtempSync(join(tmpdir(), `aether-doctor-${runId.slice(0, 8)}-`));
  try {
    const authed = Boolean(await ctx.tokens.get());
    const authCheck = check({ id: "auth.credential", category: "auth", title: "Authentication" }, {
      configured: axis(authed ? "yes" : "no"),
      reachable: notApplicable("the stored credential is local"),
      // Deliberately not refreshed: a health command must not rotate a token.
      verified: axis(authed ? "yes" : "no", {
        checkedAt: now(),
        evidence: authed ? "credential present; not refreshed" : "signed out",
      }),
      severity: authed ? "info" : "warning",
      ...(authed ? {} : { remediation: "run: aether auth login" }),
    });

    const independent = await Promise.all([
      catalogProbe(ctx, timeoutMs),
      openerProbe(options),
      Promise.resolve(githubProbe(runner)),
      Promise.resolve(branchProbe(runner, cwd)),
      mcpProbe(client, store, timeoutMs),
      Promise.resolve(custodyProbe(sandbox, runId)),
    ]);

    const agent = authed
      ? await agentProbes(ctx, ledger, { ...options, runId, timeoutMs }, sandbox)
      : agentUnproven("signed out; the agent loop cannot be exercised");

    return buildReport(
      "live",
      [authCheck, ...agent, ...independent, ...automationChecks(), spendCheck(ledger)],
      now(),
    );
  } finally {
    // Every temp file this run created lives under `sandbox`, so one removal
    // is the whole cleanup.
    try {
      rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // A leftover doctor sandbox is swept by `doctor --fix`.
    }
  }
}
