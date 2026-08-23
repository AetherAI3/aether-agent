// AppContext — assembled once in main, threaded to every command.

import type { AetherConfig } from "../types.js";
import type { ApiClient } from "./transport.js";
import type { TokenStore } from "./auth.js";

export interface GlobalFlags {
  /** Forced model id (--model). */
  model?: string;
  /** Orchestrator agent id (--agent / `run <agent>`). */
  agent?: string;
  /** Emit raw frames as JSON lines (--json). */
  json: boolean;
  /** Show audit signature inline (--audit). */
  audit: boolean;
  /** Auto-confirm prompts (--yes). */
  yes: boolean;
  /** Working directory for the coding workspace (--cwd). */
  cwd: string;
  /** Explicit offline agent selection (--local); cloud memory must stay disabled. */
  local?: boolean;
  /** Select everything rather than a named subset (--all). */
  all?: boolean;
  /** The verification command (--test-cmd), handed to the VerifyRunner. */
  testCmd?: string;
}

export interface AppContext {
  cfg: AetherConfig;
  api: ApiClient;
  tokens: TokenStore;
  flags: GlobalFlags;
  /** Ask the user a yes/no question (readline y/N; `--yes` short-circuits).
   * Injected so slash-command confirmations are testable. */
  confirm: (q: string) => Promise<boolean>;
}
