// AppContext — assembled once in main, threaded to every command.

import type { AetherConfig } from "../types.js";
import type { ApiClient } from "./transport.js";
import type { TokenStore } from "./auth.js";

export interface GlobalFlags {
  /** Forced model id (--model). */
  model?: string;
  /** Effort tier requested by --effort. */
  effort?: string;
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
  /** Widen a listing past the current workspace (--all). Global rather than one
   *  command's, because several commands already answer to that spelling — the
   *  dispatch table cannot hand it to any single one of them without changing
   *  what it means for the others. */
  all?: boolean;
  /** Output path (--out) for the commands that write a file. Global for the
   *  same reason as --all. */
  out?: string;
  /** The verification command (--test-cmd), handed to the VerifyRunner. */
  testCmd?: string;
  /** Prior session requested by --resume. Headless surfaces must explicitly
   * reject unsupported continuation instead of silently discarding it. */
  resume?: string;
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
