import type { ApiClient } from "./transport.js";

// QOPC: Aether's hosted, cloud-only agentic memory backend (facts + skills
// synced across sessions/devices). Distinct from local pins/snapshots, which
// never leave this machine — see core/memory.ts's tier split.
export const QOPC_MEMORY_PATH = "/agent/memory/qopc?limit=100";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FACTS = 100;
const MAX_SKILLS = 1000;

export type CloudMemoryKind = "episodic" | "semantic";

export interface CloudMemoryFact {
  id: string;
  kind: CloudMemoryKind;
  createdAt?: string;
}

export interface CloudMemorySkill {
  id: string;
  lastSeenAt?: string;
}

export interface CloudMemorySnapshot {
  facts: CloudMemoryFact[];
  skills: CloudMemorySkill[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function uuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export function parseCloudMemory(value: unknown): CloudMemorySnapshot {
  const body = record(value);
  if (!body || !Array.isArray(body["memories"]) || !Array.isArray(body["skills"])) {
    throw new Error("invalid QOPC memory response");
  }
  const facts: CloudMemoryFact[] = [];
  for (const value of body["memories"].slice(0, MAX_FACTS)) {
    const item = record(value);
    const id = uuid(item?.["fact_id"]);
    const kind = item?.["kind"];
    if (!id || (kind !== "episodic" && kind !== "semantic")) continue;
    const createdAt = timestamp(item?.["created_at"]);
    facts.push({ id, kind, ...(createdAt ? { createdAt } : {}) });
  }
  const skills: CloudMemorySkill[] = [];
  for (const value of body["skills"].slice(0, MAX_SKILLS)) {
    const item = record(value);
    const id = uuid(item?.["id"]);
    if (!id) continue;
    const lastSeenAt = timestamp(item?.["last_seen_at"]);
    skills.push({ id, ...(lastSeenAt ? { lastSeenAt } : {}) });
  }
  return { facts, skills };
}

export async function fetchCloudMemory(
  api: ApiClient,
  timeoutMs = 2000,
): Promise<CloudMemorySnapshot> {
  const controller = new AbortController();
  const boundedMs = Math.max(50, Math.min(timeoutMs, 10_000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("QOPC memory request timed out"));
    }, boundedMs);
    timer.unref?.();
  });
  try {
    const value = await Promise.race([
      api.getJson<unknown>(QOPC_MEMORY_PATH, controller.signal),
      timeout,
    ]);
    return parseCloudMemory(value);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type CloudMemoryDeleteTarget = "memory" | "skill";

export async function deleteCloudMemory(
  api: ApiClient,
  target: CloudMemoryDeleteTarget,
  id: string,
): Promise<void> {
  const normalized = uuid(id);
  if (!normalized) throw new Error("invalid QOPC memory id");
  const result = await api.deleteJson<unknown>(`/agent/memory/qopc/${target}/${normalized}`);
  const body = record(result);
  if (body?.["deleted"] !== true) throw new Error("QOPC memory item was not deleted");
}
