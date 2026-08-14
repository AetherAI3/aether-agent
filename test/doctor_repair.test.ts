import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyRepair,
  FORBIDDEN,
  planRepairs,
  renderRepairPlan,
  repairIds,
  REPAIRS,
  type RepairContext,
} from "../src/core/doctor_repair.js";
import { historyPaths, loadHistory } from "../src/core/media_history.js";
import { appendEntry, type AppendInput } from "../src/core/media_history_store.js";
import { buildReport, type HealthCheck, type HealthReport } from "../src/core/health.js";

const NOW = "2026-08-14T19:42:08.194Z";
const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");

function sandbox(): Required<Pick<RepairContext, "outputDir" | "configRoot" | "custodyPath" | "cwd">> &
  RepairContext {
  const root = mkdtempSync(join(tmpdir(), "aether-repair-"));
  return {
    outputDir: join(root, "aether-output"),
    configRoot: join(root, "config"),
    custodyPath: join(root, "custody", "custody.jsonl"),
    cwd: root,
    now: NOW,
    staleMs: 1_000,
  };
}

function artifact(displayName: string): AppendInput {
  return {
    kind: "image",
    displayName,
    filePath: `/synthetic/${displayName}`,
    url: "https://example.invalid/a.png",
    model: "vision_nano_pro",
    prompt: "synthetic",
    sizeBytes: 1,
  };
}

function reportWith(repairId?: string): HealthReport {
  const check: HealthCheck = {
    id: "media.history",
    category: "media",
    title: "Media output history",
    configured: { state: "no" },
    reachable: { state: "na" },
    verified: { state: "no" },
    severity: "error",
    ...(repairId ? { repairId } : {}),
  };
  return buildReport("fix", [check], NOW);
}

test("the allowlist is closed — an unknown repair id is refused", () => {
  const result = applyRepair("rm -rf /", sandbox());
  assert.equal(result.applied, false);
  assert.match(result.detail, /not in the allowlist/);
});

test("every planned repair comes from the allowlist", () => {
  const plan = planRepairs(reportWith("media.rebuild"), sandbox());
  const allowed = new Set(repairIds());
  for (const item of plan) assert.ok(allowed.has(item.id), `${item.id} is not allowlisted`);
});

test("no repair touches credentials, source, or git refs", () => {
  // The exclusions are data, so each one is asserted rather than merely
  // documented. If a repair is ever added that does one of these, the list
  // and this test are what has to change first.
  const banned = [
    /credential/i,
    /token/i,
    /rotate/i,
    /login/i,
    /oauth/i,
    /uvt|spend|settle/i,
    /model invocation/i,
    /git (commit|reset|clean|checkout|merge|rebase|push|pull)/i,
    /branch deletion/i,
    /dispatch/i,
    /predator/i,
  ];
  for (const repair of REPAIRS) {
    const described = `${repair.id} ${repair.title} ${repair.action}`;
    for (const pattern of banned) {
      assert.equal(pattern.test(described), false, `${repair.id} describes a forbidden action`);
    }
  }
  // `git worktree prune` is the one git call, and it is metadata-only.
  const worktree = REPAIRS.find((repair) => repair.id === "git.worktrees");
  assert.match(String(worktree?.action), /metadata only, never a checkout/);
  assert.ok(FORBIDDEN.length >= 10);
});

test("the plan is shown with exact scope, risk and backup before anything runs", () => {
  const plan = planRepairs(reportWith("state.directories"), sandbox());
  const rendered = renderRepairPlan(plan);
  assert.match(rendered, /nothing runs until you confirm/);
  assert.match(rendered, /Never performed by --fix/);
  for (const item of plan) {
    assert.ok(item.scope.length > 0, `${item.id} was planned with an empty scope`);
    assert.match(rendered, new RegExp(item.id.replace(".", "\\.")));
  }
});

test("state.directories creates only the missing Aether roots", () => {
  const ctx = sandbox();
  assert.equal(existsSync(ctx.configRoot), false);
  assert.equal(applyRepair("state.directories", ctx).applied, true);
  assert.equal(existsSync(ctx.configRoot), true);
  assert.equal(existsSync(ctx.outputDir), true);

  // Idempotent: a second run has nothing to do.
  assert.equal(applyRepair("state.directories", ctx).applied, false);
});

test("a live lock is left alone; only a provably abandoned one is removed", () => {
  const ctx = sandbox();
  applyRepair("state.directories", ctx);
  const paths = historyPaths(ctx.outputDir);

  // Owner is this very process — not abandoned.
  writeFileSync(
    paths.lock,
    JSON.stringify({ pid: process.pid, host: hostname(), startedAt: NOW, label: "media-history" }),
  );
  // Age is measured against the injected clock, so pin the mtime to it.
  utimesSync(paths.lock, new Date(NOW), new Date(NOW));
  assert.equal(applyRepair("state.stale-locks", ctx).applied, false);
  assert.equal(existsSync(paths.lock), true, "a live lock must survive");

  // Same stamp, but old enough to be provably abandoned.
  utimesSync(paths.lock, LONG_AGO, LONG_AGO);
  assert.equal(applyRepair("state.stale-locks", ctx).applied, true);
  assert.equal(existsSync(paths.lock), false);
});

test("only abandoned transaction temps are removed", () => {
  const ctx = sandbox();
  applyRepair("state.directories", ctx);
  const fresh = join(ctx.outputDir, ".genlog.json.1.1.tmp");
  const stale = join(ctx.outputDir, ".genlog.json.2.1.tmp");
  const keep = join(ctx.outputDir, "hero.png");
  writeFileSync(fresh, "x");
  writeFileSync(stale, "x");
  writeFileSync(keep, "x");
  // Age is measured against the injected clock, so pin both mtimes rather than
  // letting the wall clock decide which side of the threshold they land on.
  utimesSync(fresh, new Date(NOW), new Date(NOW));
  utimesSync(stale, LONG_AGO, LONG_AGO);

  assert.equal(applyRepair("state.temp", ctx).applied, true);
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(fresh), true, "an in-flight write must not be swept");
  assert.equal(existsSync(keep), true, "a real artifact must never be touched");
});

test("media.rebuild preserves the corrupt original and restores a valid index", () => {
  const ctx = sandbox();
  applyRepair("state.directories", ctx);
  const paths = historyPaths(ctx.outputDir);
  appendEntry(paths, artifact("first.png"), { now: NOW });
  appendEntry(paths, artifact("second.png"), { now: NOW });
  writeFileSync(paths.primary, "not json at all");

  const result = applyRepair("media.rebuild", ctx);
  assert.equal(result.applied, true);
  assert.ok(result.preserved, "the unreadable original must be kept as evidence");
  assert.equal(readFileSync(String(result.preserved), "utf8"), "not json at all");
  assert.equal(loadHistory(paths, NOW).state, "ok");
  assert.ok(readdirSync(ctx.outputDir).some((name) => name.includes(".corrupt.")));
});

test("media.rebuild is a no-op on a healthy index", () => {
  const ctx = sandbox();
  applyRepair("state.directories", ctx);
  appendEntry(historyPaths(ctx.outputDir), artifact("ok.png"), { now: NOW });

  const result = applyRepair("media.rebuild", ctx);
  assert.equal(result.applied, false);
  assert.match(result.detail, /already healthy/);
});

test("a repair is re-checked at apply time, so a stale plan cannot force a mutation", () => {
  const ctx = sandbox();
  applyRepair("state.directories", ctx);
  const paths = historyPaths(ctx.outputDir);
  writeFileSync(paths.primary, "not json at all");

  const plan = planRepairs(reportWith("media.rebuild"), ctx);
  assert.ok(plan.some((item) => item.id === "media.rebuild"));

  // The condition resolves before the plan is applied.
  appendEntry(paths, artifact("ok.png"), { now: NOW });
  assert.equal(applyRepair("media.rebuild", ctx).applied, false);
});

test("a check with no repairId never pulls in a targeted repair", () => {
  const plan = planRepairs(reportWith(undefined), sandbox());
  assert.equal(plan.some((item) => item.id === "media.rebuild"), false);
});
