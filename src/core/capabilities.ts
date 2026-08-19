// Capability contract resolution: server manifest when reachable and
// compatible, packaged offline fallback otherwise. Never mixes the two —
// exactly one contract (with visible provenance) is active per process.

import {
  AGENT_CAPABILITIES_FALLBACK,
  AGENT_CAPABILITIES_DIGEST,
  AGENT_CAPABILITIES_SOURCE,
} from "../generated/agent_capabilities.js";
import type { ApiClient } from "./transport.js";

export const AGENT_CAPABILITIES_PATH = "/agent/capabilities";

export interface CapabilityOverlayFeature {
  enabled: boolean;
  reason?: string;
}

export interface ResolvedCapabilities {
  /** The active contract object (server or fallback — never merged). */
  contract: Record<string, unknown>;
  digest: string;
  source: "server" | "fallback";
  /** Server-only runtime feature overlay; null on the fallback path. */
  overlay: Record<string, CapabilityOverlayFeature> | null;
  /** Non-fatal notes (offline, version skew) for the UI to render honestly. */
  warnings: readonly string[];
}

interface ServerCapabilitiesResponse {
  contract?: Record<string, unknown>;
  digest?: string;
  overlay?: { features?: Record<string, CapabilityOverlayFeature> };
}

export function fallbackCapabilities(warnings: readonly string[] = []): ResolvedCapabilities {
  return {
    contract: AGENT_CAPABILITIES_FALLBACK as unknown as Record<string, unknown>,
    digest: AGENT_CAPABILITIES_DIGEST,
    source: "fallback",
    overlay: null,
    warnings,
  };
}

/**
 * Resolve the active contract. Offline or on any server error, the packaged
 * fallback serves local help and operation — with a visible warning, never a
 * silent downgrade. An incompatible major contract version keeps the fallback
 * and says so; it never adopts a vocabulary this build does not understand.
 */
export async function resolveCapabilities(api: ApiClient): Promise<ResolvedCapabilities> {
  let response: ServerCapabilitiesResponse;
  try {
    response = await api.getJson<ServerCapabilitiesResponse>(AGENT_CAPABILITIES_PATH);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fallbackCapabilities(["server capability manifest unreachable (" + detail + ") — using packaged snapshot"]);
  }
  const contract = response.contract;
  const digest = response.digest;
  if (!contract || typeof digest !== "string") {
    return fallbackCapabilities(["server capability response malformed — using packaged snapshot"]);
  }
  const serverVersion = contract["contract_version"];
  const localVersion = (AGENT_CAPABILITIES_FALLBACK as { contract_version: number }).contract_version;
  if (typeof serverVersion !== "number" || Math.trunc(serverVersion) !== Math.trunc(localVersion)) {
    return fallbackCapabilities([
      "server capability contract v" + String(serverVersion) + " is incompatible with this client (v" +
        localVersion + ") — using packaged snapshot; upgrade the agent",
    ]);
  }
  const warnings: string[] = [];
  if (digest !== AGENT_CAPABILITIES_DIGEST) {
    warnings.push("server contract digest differs from the packaged snapshot (server wins; consider upgrading)");
  }
  return {
    contract,
    digest,
    source: "server",
    overlay: response.overlay?.features ?? null,
    warnings,
  };
}

export function packagedCapabilitySource(): typeof AGENT_CAPABILITIES_SOURCE {
  return AGENT_CAPABILITIES_SOURCE;
}

/** Render for `aether capabilities` — static support separate from availability. */
export function renderCapabilities(resolved: ResolvedCapabilities, availableOnly = false): string {
  const lines: string[] = [];
  lines.push(
    "Capability contract v" + String(resolved.contract["contract_version"]) +
      " · " + resolved.source + " · sha256:" + resolved.digest.slice(0, 12) + "…",
  );
  for (const warning of resolved.warnings) lines.push("! " + warning);
  const tools = resolved.contract["tools"];
  if (Array.isArray(tools)) {
    lines.push("");
    lines.push("TOOLS (static support)");
    for (const tool of tools) {
      const record = tool as Record<string, unknown>;
      lines.push(
        "  " + String(record["name"]).padEnd(14) +
          String(record["side_effect"]).padEnd(9) +
          String(record["permission"]),
      );
    }
  }
  const features = resolved.contract["client_features"];
  if (Array.isArray(features)) {
    lines.push("");
    lines.push("FEATURES" + (resolved.overlay ? " (runtime availability from server)" : " (static — server availability unknown offline)"));
    for (const feature of features) {
      const name = String(feature);
      const overlayEntry = resolved.overlay?.[name];
      const state = overlayEntry
        ? overlayEntry.enabled ? "available" : "unavailable" + (overlayEntry.reason ? " (" + overlayEntry.reason + ")" : "")
        : "supported";
      if (availableOnly && overlayEntry && !overlayEntry.enabled) continue;
      lines.push("  " + name.padEnd(20) + state);
    }
  }
  return lines.join("\n") + "\n";
}
