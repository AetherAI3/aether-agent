import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { cmdDoctor } from "../src/commands/doctor.js";
import type { AppContext } from "../src/core/context.js";
import {
  executeRepairs,
  planRepairs,
  repairReceiptsPath,
  type RepairAction,
  type RepairPlan,
} from "../src/core/diagnostics/repair.js";

const NOW = "2026-08-14T12:00:00.000Z";

function setup(): { configDir: string; ctx: AppContext; restore(): void } {
  const root = mkdtempSync(join(tmpdir(), "aether-repair-"));
  const configDir = join(root, "config");
  mkdirSync(configDir, { recursive: true });
  const previous = process.env["AETHER_CONFIG_DIR"];
  process.env["AETHER_CONFIG_DIR"] = configDir;
  const ctx = {
    cfg: { baseUrl: "https://api.example.test" },
    flags: { cwd: root, json: false, audit: false, yes: false },
    tokens: { get: async () => null },
    confirm: async () => false,
  } as unknown as AppContext;
  return {
    configDir,
    ctx,
    restore: () => {
      if (previous == null) delete process.env["AETHER_CONFIG_DIR"];
      else process.env["AETHER_CONFIG_DIR"] = previous;
    },
  };
}

function sink(): { out: Writable; text(): string } {
  const chunks: string[] = [];
  return {
    out: { write: (value: string) => (chunks.push(value), true) } as unknown as Writable,
    text: () => chunks.join(""),
  };
}

test("doctor --fix is a dry run: plan printed, nothing mutated", async () => {
  const fixture = setup();
  try {
    const corrupt = join(fixture.configDir, "skill-settings.json");
    writeFileSync(corrupt, "{corrupt", "utf8");
    const captured = sink();
    const code = await cmdDoctor(fixture.ctx, ["--fix"], { out: captured.out });
    assert.equal(code, 0);
    assert.match(captured.text(), /repair\.skill_index/);
    assert.match(captured.text(), /dry run/);
    assert.equal(readFileSync(corrupt, "utf8"), "{corrupt");
    assert.equal(existsSync(repairReceiptsPath()), false);
  } finally {
    fixture.restore();
  }
});

test("apply backs up first, repairs the store, and writes a metadata receipt", async () => {
  const fixture = setup();
  try {
    const corrupt = join(fixture.configDir, "skill-settings.json");
    writeFileSync(corrupt, "{corrupt", "utf8");
    const captured = sink();
    const code = await cmdDoctor(fixture.ctx, ["--fix", "--yes"], {
      out: captured.out,
      dependencies: { now: NOW },
    });
    assert.equal(code, 0);
    const repaired = JSON.parse(readFileSync(corrupt, "utf8")) as Record<string, unknown>;
    assert.equal(repaired["schema_version"], 1);
    assert.deepEqual(repaired["settings"], []);
    const backup = corrupt + ".corrupt-" + process.pid;
    assert.equal(readFileSync(backup, "utf8"), "{corrupt");
    const receipts = readFileSync(repairReceiptsPath(), "utf8").trim().split("\n");
    assert.equal(receipts.length, 1);
    const receipt = JSON.parse(receipts[0]!) as Record<string, unknown>;
    assert.equal(receipt["repair_id"], "repair.skill_index");
    assert.equal(receipt["target_class"], "skill-index-store");
    assert.equal(receipt["verified"], true);
    assert.equal(receipt["ts"], NOW);
    assert.match(String(receipt["before_digest"]), /^[0-9a-f]{64}$/);
    assert.match(String(receipt["after_digest"]), /^[0-9a-f]{64}$/);
    // Metadata-only: the corrupt file's content never lands in a receipt.
    assert.equal(receipts[0]!.includes("{corrupt"), false);
  } finally {
    fixture.restore();
  }
});

test("repair.config_dir creates a missing config directory", () => {
  const fixture = setup();
  try {
    rmSync(fixture.configDir, { recursive: true, force: true });
    const plans = planRepairs(NOW);
    assert.deepEqual(plans.map((plan) => plan.repairId), ["repair.config_dir"]);
    const outcomes = executeRepairs(plans, NOW);
    assert.equal(outcomes[0]?.verified, true);
    assert.equal(existsSync(fixture.configDir), true);
  } finally {
    fixture.restore();
  }
});

test("repair.stale_tmp lists only day-old *.tmp files and removes them", () => {
  const fixture = setup();
  try {
    const stale = join(fixture.configDir, "old.tmp");
    const fresh = join(fixture.configDir, "new.tmp");
    writeFileSync(stale, "x", "utf8");
    writeFileSync(fresh, "x", "utf8");
    const twoDaysAgo = (Date.parse(NOW) - 2 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(stale, twoDaysAgo, twoDaysAgo);
    const plans = planRepairs(NOW);
    assert.deepEqual(plans.map((plan) => plan.target), [stale]);
    executeRepairs(plans, NOW);
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(fresh), true);
  } finally {
    fixture.restore();
  }
});

test("verify failure rolls back from the backup and receipts verified:false", () => {
  const fixture = setup();
  try {
    const target = join(fixture.configDir, "victim.json");
    writeFileSync(target, "original", "utf8");
    const plan: RepairPlan = {
      repairId: "repair.test_rollback",
      targetClass: "test",
      target,
      backupPath: target + ".corrupt-" + process.pid,
      detail: "test",
    };
    const failing: RepairAction = {
      id: "repair.test_rollback",
      targetClass: "test",
      describe: () => "test",
      plan: () => [plan],
      apply: (p) => writeFileSync(p.target, "mutated", "utf8"),
      verify: () => false,
      rollback: (p) => {
        if (p.backupPath) writeFileSync(p.target, readFileSync(p.backupPath));
      },
    };
    const outcomes = executeRepairs([plan], NOW, [failing]);
    assert.equal(outcomes[0]?.applied, true);
    assert.equal(outcomes[0]?.verified, false);
    assert.equal(outcomes[0]?.rolledBack, true);
    assert.equal(readFileSync(target, "utf8"), "original");
    const receipt = JSON.parse(readFileSync(repairReceiptsPath(), "utf8").trim()) as Record<string, unknown>;
    assert.equal(receipt["verified"], false);
  } finally {
    fixture.restore();
  }
});
