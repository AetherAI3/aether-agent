// remote_redaction.ts — the host-side payload ALLOWLIST for Remote Control
// (AETHER-AGENT-LIVE-01, ADR-0007 §5). Everything uploaded to the remote-session
// broker passes through sanitizeRemotePayload() first. The rule is allowlist,
// not blocklist: a key that is not explicitly allowed for its event type does
// not leave the machine, whatever it contains.
//
// The host NEVER uploads: environment variables, auth tokens, arbitrary file
// contents, unredacted shell history, absolute local paths (project-relative
// identifiers only), MCP credentials, browser cookies, hidden prompts/private
// memory. That list is encoded here as RC_FORBIDDEN_KEYS plus the per-type
// allowlists, and enforced again broker-side per the ADR.
//
// Detection patterns are reused from core/redaction.ts — the single owner of
// secret-shaped scrubbing — so a new detector there protects this sink too.

import { homedir } from "node:os";
import { redactEnvValues, redactInline, SENSITIVE_KEY } from "./redaction.js";

/** The frozen `aether.remote_session.v1` event vocabulary (ADR-0007 §2). */
export const RC_EVENT_TYPES = [
  "session", "transcript", "plan", "subagent", "tool_activity", "diff_summary",
  "tests", "ci", "pr_status", "artifact", "preview", "presence", "done", "error",
] as const;
export type RcEventType = (typeof RC_EVENT_TYPES)[number];

/** Categories the host must never upload — kept as data so the PR body, the
 *  tests, and the code all quote the same list. */
export const RC_NEVER_UPLOADED = [
  "environment variables",
  "auth tokens",
  "arbitrary file contents",
  "unredacted shell history",
  "absolute local paths",
  "MCP credentials",
  "browser cookies",
  "hidden prompts / private memory",
] as const;

/** Key names dropped regardless of event type, before the allowlist runs.
 *  SENSITIVE_KEY (token/secret/password/…) is applied on top of these. */
const RC_FORBIDDEN_KEYS =
  /^(env|environ|environment|env_vars?|cookies?|shell_history|history|prompt|prompts|hidden_prompt|system_prompt|memory|private_memory|mcp|mcp_credentials?|file_contents?|contents?|body|raw|stdin|stdout|stderr)$/i;

/** Per-type allowed payload keys — identifiers and summaries, never raw content. */
const RC_ALLOWED_KEYS: Readonly<Record<RcEventType, readonly string[]>> = {
  session: ["state", "session_name", "repo", "branch", "base_commit", "dirty_file_count", "execution", "protocol_version"],
  transcript: ["role", "kind", "summary"],
  plan: ["step", "total_steps", "title", "status"],
  subagent: ["subagent_id", "name", "status", "summary"],
  tool_activity: ["tool", "target", "status", "summary"],
  diff_summary: ["files_changed", "insertions", "deletions", "files"],
  tests: ["framework", "status", "passed", "failed", "skipped", "summary"],
  ci: ["provider", "status", "run_id", "url"],
  pr_status: ["repo", "number", "state", "title", "url", "checks_summary"],
  artifact: ["artifact_id", "kind", "title", "summary"],
  preview: ["phase", "url", "instance_id"],
  presence: ["role", "device_id", "state"],
  done: ["status", "summary"],
  error: ["code", "message"],
};

/** Broker frame bound (ADR-0007 §2): payload canonical JSON ≤ 32 KiB. */
export const RC_MAX_PAYLOAD_BYTES = 32 * 1024;
/** Per-string bound — summaries, never documents. */
const MAX_STRING_LENGTH = 1024;
const MAX_LIST_ITEMS = 64;

const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/;
// C0 controls + DEL, built without literal control characters in the source.
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, "g");

/** Rewrite a path-shaped string to a project-relative identifier, or refuse it.
 *  Exported for tests; the sanitizer applies it to every string value. */
export function relativizePath(value: string, projectRoot: string): string {
  const normalizedRoot = projectRoot.replace(/[\\/]+$/, "");
  for (const root of [normalizedRoot, normalizedRoot.replaceAll("\\", "/")]) {
    if (root && (value === root || value.startsWith(root + "/") || value.startsWith(root + "\\"))) {
      const rest = value.slice(root.length).replace(/^[\\/]+/, "").replaceAll("\\", "/");
      return rest === "" ? "." : rest;
    }
  }
  if (ABSOLUTE_PATH.test(value) || (homedir() && value.startsWith(homedir()))) return "[external-path]";
  return value;
}

function sanitizeString(value: string, projectRoot: string, env: NodeJS.ProcessEnv): string {
  let out = value.replace(CONTROL_CHARS, "");
  out = relativizePath(out, projectRoot);
  // Embedded (not whole-string) absolute roots still get scrubbed.
  const roots = [projectRoot, projectRoot.replaceAll("\\", "/"), homedir(), homedir().replaceAll("\\", "/")];
  for (const root of roots) if (root) out = out.split(root).join("[path]");
  out = redactEnvValues(out, env);
  out = redactInline(out); // bearer/key=value scrub + 512-char hard cap
  return out.slice(0, MAX_STRING_LENGTH);
}

export interface SanitizeOptions {
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Reduce an arbitrary payload to the bounded, allowlisted shape for its event
 * type. Unknown event types yield null (the event must not be sent). The
 * result is always JSON-safe scalars, string lists, and bounded strings —
 * within RC_MAX_PAYLOAD_BYTES — or null when nothing safe remains.
 */
export function sanitizeRemotePayload(
  eventType: string,
  payload: Record<string, unknown>,
  options: SanitizeOptions,
): Record<string, unknown> | null {
  if (!(RC_EVENT_TYPES as readonly string[]).includes(eventType)) return null;
  const allowed = RC_ALLOWED_KEYS[eventType as RcEventType];
  const env = options.env ?? process.env;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (RC_FORBIDDEN_KEYS.test(key) || SENSITIVE_KEY.test(key)) continue; // defense in depth
    const value = payload[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = sanitizeString(value, options.projectRoot, env);
    else if (Array.isArray(value)) {
      const items = value
        .filter((item): item is string => typeof item === "string")
        .slice(0, MAX_LIST_ITEMS)
        .map((item) => sanitizeString(item, options.projectRoot, env));
      if (items.length) out[key] = items;
    }
    // Nested objects are refused: the wire shapes are flat by construction.
  }
  if (Object.keys(out).length === 0) return null;
  if (Buffer.byteLength(JSON.stringify(out), "utf8") > RC_MAX_PAYLOAD_BYTES) {
    // Fail closed: an oversized frame is replaced by an honest notice, never
    // trimmed field-by-field into something that silently lies by omission.
    return { truncated: true, note: "payload exceeded the 32 KiB frame bound and was withheld" };
  }
  return out;
}
