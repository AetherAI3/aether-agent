import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApiClient } from "../src/core/transport.js";
import {
  deleteCloudMemory,
  fetchCloudMemory,
  parseCloudMemory,
  QOPC_MEMORY_PATH,
} from "../src/core/cloud_memory.js";

const FACT = "11111111-1111-4111-8111-111111111111";
const SEMANTIC = "22222222-2222-4222-8222-222222222222";
const SKILL = "33333333-3333-4333-8333-333333333333";
const SECRET = "SENTINEL-cloud-memory-content";

function payload(): unknown {
  return {
    memories: [
      { fact_id: FACT, text: SECRET, kind: "episodic", confidence: 0.8, created_at: "2026-07-01T12:00:00Z" },
      { fact_id: SEMANTIC, text: SECRET, kind: "semantic", confidence: 0.9, created_at: "2026-07-02T12:00:00Z" },
      { fact_id: "bad", text: SECRET, kind: "semantic" },
      { fact_id: FACT, text: SECRET, kind: "future-kind" },
    ],
    skills: [
      { id: SKILL, skill_name: SECRET, description: SECRET, last_seen_at: "2026-07-03T12:00:00Z" },
      { id: "../escape", skill_name: SECRET },
    ],
  };
}

test("QOPC adapter validates cloud shapes and retains metadata only", () => {
  const snapshot = parseCloudMemory(payload());
  assert.deepEqual(snapshot, {
    facts: [
      { id: FACT, kind: "episodic", createdAt: "2026-07-01T12:00:00.000Z" },
      { id: SEMANTIC, kind: "semantic", createdAt: "2026-07-02T12:00:00.000Z" },
    ],
    skills: [
      { id: SKILL, lastSeenAt: "2026-07-03T12:00:00.000Z" },
    ],
  });
  assert.equal(JSON.stringify(snapshot).includes(SECRET), false);
});

test("QOPC adapter rejects malformed envelopes instead of inventing empty memory", () => {
  assert.throws(() => parseCloudMemory({ memories: [] }), /invalid QOPC/);
  assert.throws(() => parseCloudMemory(null), /invalid QOPC/);
});

test("QOPC fetch uses the canonical owner-scoped cloud route and an abort signal", async () => {
  let calledPath = "";
  let calledSignal: AbortSignal | undefined;
  const api = {
    getJson: async (path: string, signal?: AbortSignal) => {
      calledPath = path;
      calledSignal = signal;
      return payload();
    },
  } as unknown as ApiClient;
  const result = await fetchCloudMemory(api, 500);
  assert.equal(calledPath, QOPC_MEMORY_PATH);
  assert.ok(calledSignal instanceof AbortSignal);
  assert.equal(result.facts.length, 2);
});

test("QOPC delete is typed, UUID-guarded, and requires backend acknowledgement", async () => {
  const paths: string[] = [];
  const api = {
    deleteJson: async (path: string) => {
      paths.push(path);
      return { deleted: true };
    },
  } as unknown as ApiClient;
  await deleteCloudMemory(api, "memory", FACT);
  await deleteCloudMemory(api, "skill", SKILL);
  assert.deepEqual(paths, [
    `/agent/memory/qopc/memory/${FACT}`,
    `/agent/memory/qopc/skill/${SKILL}`,
  ]);

  await assert.rejects(
    deleteCloudMemory(api, "memory", "../escape"),
    /invalid QOPC memory id/,
  );
  const refused = {
    deleteJson: async () => ({ deleted: false }),
  } as unknown as ApiClient;
  await assert.rejects(
    deleteCloudMemory(refused, "memory", FACT),
    /was not deleted/,
  );
});
