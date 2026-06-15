// Shared types for the Aether Code CLI.
// The CLI is a thin front door: it never enforces UVT or signs anything.
// Aether's servers do enforcement and signing. The client only
// builds requests, streams frames, renders, and applies edits locally.

export type PermissionMode = "ask" | "auto" | "skip";

/** Brain selection: 'auto' = cloud when signed in, local Ollama when not. */
export type BackendPref = "auto" | "local" | "cloud";

export interface AetherConfig {
  /** the Aether API base URL. The only host the CLI talks to. */
  baseUrl: string;
  /** Default model id when --model is not passed (server smart-routes if empty). */
  defaultModel: string;
  /** Edit/command gating. Mirrors Aether Code desktop "skip-perms" setting. */
  permissionMode: PermissionMode;
  /** Auto-apply streamed edits without per-edit prompt. Mirrors Aether Code. */
  autoApply: boolean;
  /** Anonymous usage telemetry opt-in. */
  telemetry: boolean;
  /** Which brain runs a turn. 'auto' is local-first: cloud when authed, else
   * local Ollama. Overridden per-process by the AETHER_BACKEND env var. */
  backend: BackendPref;
}

// Wire DTO from GET /models (snake_case mirrors the server catalog). A single
// list unifies chat models and orchestrators (Neo/Kronus) via `kind`.
export interface CatalogItem {
  id: string;
  label: string;
  kind: "model" | "orchestrator";
  provider: string | null;
  context_window: number | null;
  /** Lowest tier that can use it: free | solo | pro | team. */
  tier_min: string | null;
  /** Provider/env gate satisfied. */
  enabled: boolean;
  /** enabled AND the caller's tier includes it. */
  available: boolean;
  /** Hard monthly UVT ceiling on the caller's tier, or null if uncapped. */
  monthly_uvt_cap: number | null;
  is_default: boolean;
}

export interface CatalogResponse {
  models: CatalogItem[];
  tier: string;
  default: string;
}
