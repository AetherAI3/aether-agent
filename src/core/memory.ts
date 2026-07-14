import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import type { ApiClient } from "./transport.js";
import { deleteCloudMemory, fetchCloudMemory } from "./cloud_memory.js";
import {
  getRegistry,
  listSnapshots,
  snapshotsRoot,
  type ContextRegistry,
} from "./context_registry.js";
import { historyPath, legacyHistoryPath } from "./history_store.js";
import { goalsFile } from "./goals.js";
import { logsRoot } from "./session_log.js";
import {
  isCurrentWorkspace,
  resolveOpaqueChild,
  workspaceFingerprint,
  workspaceScope,
  type WorkspaceScope,
} from "./workspace_scope.js";

/**
 * Aether Agent memory model — the four tiers surfaced by
 * `aether memory status|inspect|forget|prune`.
 *
 * - `working`    locally computed from this machine's registry pins and context
 *                snapshots (context_registry.ts). Never touches the network.
 * - `episodic`   QOPC-hosted behavioral facts (server `kind: "episodic"`),
 *                fetched via cloud_memory.ts. Requires an authenticated cloud backend.
 * - `semantic`   QOPC-hosted behavioral facts (server `kind: "semantic"`), the same
 *                source as `episodic`, split client-side by the fact's `kind` field.
 *                NOTE: unrelated to the `vault` command's "semantic memory" (an
 *                Obsidian-notes store) or README's "working memory" (the
 *                Unlimited-Context engine) — those are separate subsystems that
 *                happen to reuse this cognitive-science vocabulary.
 * - `procedural` QOPC-hosted skills reported by the server, also via cloud_memory.ts.
 *
 * Only `working` is computed locally; the other three are always server-sourced and
 * are reported empty/unavailable when no cloud backend is reachable — compare
 * `localMemoryReport` (local-only) with `memoryReport` (attempts the cloud fetch).
 */
export type MemoryTier = "working" | "episodic" | "semantic" | "procedural";
export type MemoryHealth = "available" | "degraded" | "unavailable";

export interface MemorySourceStatus {
  source: string;
  status: MemoryHealth;
  count: number;
  current: number;
  other: number;
  unscoped: number;
  account: number;
  detail?: string;
}

export interface MemoryItem {
  id: string;
  tier: MemoryTier;
  source: string;
  scope: WorkspaceScope | "account";
  createdAt?: string;
  deletable: boolean;
}

export interface MemoryTierReport {
  tier: MemoryTier;
  sources: MemorySourceStatus[];
  items: MemoryItem[];
}

export interface MemoryReport {
  schemaVersion: 1;
  generatedAt: string;
  workspaceId: string;
  agenticBackend: "cloud-only" | "qopc";
  tiers: MemoryTierReport[];
}

export interface MemoryRoots {
  logs: string;
  snapshots: string;
  goals: string;
  history: string;
  legacyHistory: string;
}

export interface PruneResult {
  dryRun: boolean;
  cutoff: string;
  candidates: MemoryItem[];
  removed: string[];
  failures: Array<{ id: string; reason: string }>;
}

const hashId = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);

function defaultMemoryRoots(cwd: string): MemoryRoots {
  return {
    logs: logsRoot(),
    snapshots: snapshotsRoot(),
    goals: goalsFile(),
    history: historyPath(cwd),
    legacyHistory: legacyHistoryPath(),
  };
}

function status(
  source: string,
  items: MemoryItem[],
  health: MemoryHealth = "available",
  detail?: string,
): MemorySourceStatus {
  return {
    source,
    status: health,
    count: items.length,
    current: items.filter((item) => item.scope === "current").length,
    other: items.filter((item) => item.scope === "other").length,
    unscoped: items.filter((item) => item.scope === "unscoped").length,
    account: items.filter((item) => item.scope === "account").length,
    ...(detail ? { detail } : {}),
  };
}

function cloudOnly(source: string): MemorySourceStatus {
  return status(source, [], "unavailable", "cloud-only QOPC memory; local backend does not query it");
}

export function localMemoryReport(
  cwd: string,
  registry: ContextRegistry = getRegistry(),
  roots: MemoryRoots = defaultMemoryRoots(cwd),
  now = new Date().toISOString(),
): MemoryReport {
  const pins: MemoryItem[] = registry.pins.map((pin) => ({
    id: `pin:${hashId(pin.path)}`,
    tier: "working",
    source: "pins",
    scope: "current",
    createdAt: pin.pinnedAt,
    deletable: true,
  }));
  const snapshots: MemoryItem[] = listSnapshots(undefined, roots.snapshots).map(({ id, data }) => ({
    id: `snapshot:${id}`,
    tier: "working",
    source: "snapshots",
    scope: workspaceScope(data.cwd, cwd),
    createdAt: data.createdAt,
    deletable: isCurrentWorkspace(data.cwd, cwd),
  }));

  return {
    schemaVersion: 1,
    generatedAt: now,
    workspaceId: workspaceFingerprint(cwd),
    agenticBackend: "cloud-only",
    tiers: [
      {
        tier: "working",
        sources: [status("pins", pins), status("snapshots", snapshots)],
        items: [...pins, ...snapshots],
      },
      {
        tier: "episodic",
        sources: [cloudOnly("qopc-facts")],
        items: [],
      },
      {
        tier: "semantic",
        sources: [cloudOnly("qopc-facts")],
        items: [],
      },
      {
        tier: "procedural",
        sources: [cloudOnly("qopc-skills")],
        items: [],
      },
    ],
  };
}

export async function memoryReport(
  api: ApiClient,
  cwd: string,
  registry: ContextRegistry = getRegistry(),
  roots: MemoryRoots = defaultMemoryRoots(cwd),
  now = new Date().toISOString(),
  timeoutMs = 2000,
): Promise<MemoryReport> {
  const report = localMemoryReport(cwd, registry, roots, now);
  report.agenticBackend = "qopc";
  const episodic = report.tiers.find((tier) => tier.tier === "episodic")!;
  const semantic = report.tiers.find((tier) => tier.tier === "semantic")!;
  const procedural = report.tiers.find((tier) => tier.tier === "procedural")!;
  try {
    const snapshot = await fetchCloudMemory(api, timeoutMs);
    const facts = snapshot.facts.map((fact): MemoryItem => ({
      id: `qopc-${fact.kind}:${fact.id}`,
      tier: fact.kind,
      source: "qopc-facts",
      scope: "account",
      ...(fact.createdAt ? { createdAt: fact.createdAt } : {}),
      deletable: true,
    }));
    const episodicFacts = facts.filter((item) => item.tier === "episodic");
    const semanticFacts = facts.filter((item) => item.tier === "semantic");
    const skills = snapshot.skills.map((skill): MemoryItem => ({
      id: `qopc-skill:${skill.id}`,
      tier: "procedural",
      source: "qopc-skills",
      scope: "account",
      ...(skill.lastSeenAt ? { createdAt: skill.lastSeenAt } : {}),
      deletable: true,
    }));
    episodic.sources = [status("qopc-facts", episodicFacts)];
    episodic.items = episodicFacts;
    semantic.sources = [status("qopc-facts", semanticFacts)];
    semantic.items = semanticFacts;
    procedural.sources = [status("qopc-skills", skills)];
    procedural.items = skills;
  } catch {
    episodic.sources = [status("qopc-facts", [], "unavailable", "QOPC backend unavailable")];
    semantic.sources = [status("qopc-facts", [], "unavailable", "QOPC backend unavailable")];
    procedural.sources = [status("qopc-skills", [], "unavailable", "QOPC backend unavailable")];
  }
  return report;
}

export function tierReport(report: MemoryReport, tier: string): MemoryTierReport {
  const found = report.tiers.find((entry) => entry.tier === tier);
  if (!found) throw new Error("tier must be working, episodic, semantic, or procedural");
  return found;
}

function currentItem(report: MemoryReport, tier: MemoryTier, id: string): MemoryItem {
  const item = tierReport(report, tier).items.find((entry) => entry.id === id);
  if (!item) throw new Error("memory id not found in this tier");
  if (item.scope !== "current" || !item.deletable) {
    throw new Error("memory item is not deletable in this workspace");
  }
  return item;
}

export async function forgetCloudMemoryItem(
  api: ApiClient,
  tier: MemoryTier,
  id: string,
): Promise<void> {
  if (tier === "procedural" && id.startsWith("qopc-skill:")) {
    await deleteCloudMemory(api, "skill", id.slice("qopc-skill:".length));
    return;
  }
  const prefix = `qopc-${tier}:`;
  if ((tier === "episodic" || tier === "semantic") && id.startsWith(prefix)) {
    await deleteCloudMemory(api, "memory", id.slice(prefix.length));
    return;
  }
  throw new Error("QOPC memory id does not match this tier");
}

export function forgetMemory(
  tier: MemoryTier,
  id: string,
  cwd: string,
  registry: ContextRegistry = getRegistry(),
  roots: MemoryRoots = defaultMemoryRoots(cwd),
): void {
  const report = localMemoryReport(cwd, registry, roots);
  const item = currentItem(report, tier, id);
  const suffix = id.slice(id.indexOf(":") + 1);
  if (item.source === "pins") {
    const pin = registry.pins.find((entry) => hashId(entry.path) === suffix);
    if (!pin) throw new Error("pin no longer exists");
    registry.pins = registry.pins.filter((entry) => entry !== pin);
    registry.drops = registry.drops.filter((entry) => entry !== pin.path);
    return;
  }
  if (item.source === "snapshots") {
    unlinkSync(resolveOpaqueChild(roots.snapshots, suffix, "snapshot id"));
    return;
  }
  throw new Error("local agentic memory is disabled; durable memory is QOPC cloud-only");
}

export function pruneMemory(
  days: number,
  apply: boolean,
  cwd: string,
  registry: ContextRegistry = getRegistry(),
  roots: MemoryRoots = defaultMemoryRoots(cwd),
  nowMs = Date.now(),
): PruneResult {
  if (!Number.isInteger(days) || days < 1 || days > 36500) {
    throw new Error("days must be an integer from 1 to 36500");
  }
  const cutoffMs = nowMs - days * 86_400_000;
  const report = localMemoryReport(cwd, registry, roots, new Date(nowMs).toISOString());
  const candidates = tierReport(report, "working").items
    .filter((item) => item.source === "snapshots")
    .filter((item) => item.scope === "current" && item.deletable)
    .filter((item) => item.createdAt != null && Date.parse(item.createdAt) < cutoffMs);
  const result: PruneResult = {
    dryRun: !apply,
    cutoff: new Date(cutoffMs).toISOString(),
    candidates,
    removed: [],
    failures: [],
  };
  if (!apply) return result;
  for (const item of candidates) {
    try {
      forgetMemory(item.tier, item.id, cwd, registry, roots);
      result.removed.push(item.id);
    } catch (error) {
      result.failures.push({
        id: item.id,
        reason: error instanceof Error ? error.message : "delete failed",
      });
    }
  }
  return result;
}
