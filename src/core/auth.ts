// Auth — token storage + login.
//
// The the Aether API authenticates username/password at POST /auth/login and returns
// a `session_token`, which the CLI sends as `Authorization:
// Bearer <session_token>` on every authed call.
// Browser-based login is the default flow.
//
// TODO: prefer the OS keychain over the file store; the TokenStore
// interface keeps that swappable.

import { join } from "node:path";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { configDir } from "./config.js";
import { LOGIN_PATH, defaultRequestTimeoutMs, isCredentialSafeUrl } from "./transport.js";

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
  /** Replace the ACTIVE token without widening persistence scope (used by the
   * automatic 401→refresh path). Stores that don't distinguish may omit it;
   * callers fall back to set(). */
  update?(token: string): Promise<void>;
}

/** File-backed token store (0600). Fallback until keychain is wired. */
export class FileTokenStore implements TokenStore {
  private path = join(configDir(), ".token");

  async get(): Promise<string | null> {
    if (!existsSync(this.path)) return null;
    // O_NOFOLLOW refuses to transparently follow a symlink planted at the
    // token path by another local account — mirrors tool_executor.ts's
    // writeFile() guard. An open failure (including ELOOP) is treated the
    // same as "no token", not an error.
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    let fd: number;
    try {
      fd = openSync(this.path, fsConstants.O_RDONLY | noFollow);
    } catch {
      return null;
    }
    try {
      const buf = Buffer.alloc(8192);
      const bytes = readSync(fd, buf, 0, buf.length, 0);
      const t = buf.subarray(0, bytes).toString("utf8").trim();
      return t || null;
    } finally {
      closeSync(fd);
    }
  }

  async set(token: string): Promise<void> {
    // mkdirSync is required here: on a fresh machine nothing else creates the
    // config dir before first login, so omitting this throws ENOENT (verified
    // bug on HEAD's side). Creating dir 0700 / file 0600 AT CREATION (rather
    // than write-then-chmod) closes the race window where the token would
    // otherwise be briefly world-readable. O_NOFOLLOW refuses a symlinked
    // .token path instead of transparently writing through it.
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const fd = openSync(this.path, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollow, 0o600);
    try {
      writeFileSync(fd, token, "utf8");
    } finally {
      closeSync(fd);
    }
    try {
      chmodSync(this.path, 0o600);
    } catch {
      // non-fatal on filesystems that don't support POSIX modes.
    }
  }

  async clear(): Promise<void> {
    if (existsSync(this.path)) rmSync(this.path);
  }
}

export function defaultTokenStore(): TokenStore {
  return new FileTokenStore();
}

/**
 * A long-lived API token (PAT) starts with `aek_`; a session token (minted by
 * /auth/login or /auth/refresh) doesn't. The one canonical definition of that
 * prefix, shared by transport.ts's refreshSession() (an `aek_` token never
 * expires, so a 401 on one is never retried) and commands/auth.ts's
 * isApiToken (status/token display) — previously hand-duplicated in both
 * places, risking silent drift if the prefix scheme ever changes (LOOP-01
 * round 2; mirrors this file's own tokenStoreForInjected, added for the same
 * "one canonical decision" reason).
 */
export function isApiKeyToken(token: string | null | undefined): boolean {
  return typeof token === "string" && token.startsWith("aek_");
}

/**
 * The one canonical "injected token -> TokenStore" decision, shared by every
 * surface that resolves an embedded/injected session token (tokenStoreFromEnv
 * for the CLI entry, AetherClient's constructor for library embedders) so the
 * choice can't silently drift into hand-maintained copies (LOOP-01 round 1).
 *
 * An empty/whitespace token counts as unset and falls back to the file store.
 *
 * `persistOnLogin` is the one axis that legitimately differs by surface:
 *  - true  (EnvOverrideTokenStore): an explicit login's fresh token persists to
 *    disk too, so a NEW process (no env override) still sees it — this is the
 *    CLI-entry fix for PR #47's "✓ Logged in" evaporating with the process.
 *  - false (StaticTokenStore): the token stays in-process only. AetherClient is
 *    an embeddable library surface (desktop in-process embed, Aether AI on the
 *    web) whose consumers explicitly must NOT have a `.login()` call clobber
 *    the standalone CLI's independent on-disk session — see StaticTokenStore's
 *    doc comment below.
 */
export function tokenStoreForInjected(
  injected: string | undefined | null,
  opts: { persistOnLogin: boolean },
): TokenStore {
  const t = (injected ?? "").trim();
  if (!t) return defaultTokenStore();
  return opts.persistOnLogin ? new EnvOverrideTokenStore(t, defaultTokenStore()) : new StaticTokenStore(t);
}

/**
 * Token store for a running CLI process, choosing the source by environment.
 *
 * An injected `AETHER_TOKEN` — how the desktop app (and the web server) embed a
 * user's EXISTING session into the spawned CLI — WINS over the on-disk file
 * store, so a user already signed into AetherCloud who opens a terminal is
 * authenticated as that same account and is NEVER asked to re-run
 * `aether auth login`. With no env token (a standalone CLI user), it falls back
 * to the file store, so the normal login flow is unaffected. Mirrors
 * AetherClient's embedded-token resolution (both go through
 * tokenStoreForInjected) so the interactive REPL and the universal chat client
 * agree on auth reads; only the login-persistence axis differs (see
 * tokenStoreForInjected's doc comment).
 */
export function tokenStoreFromEnv(env: NodeJS.ProcessEnv = process.env): TokenStore {
  return tokenStoreForInjected(env["AETHER_TOKEN"], { persistOnLogin: true });
}

/**
 * Env-injected token that still honors an explicit login. The injected token
 * wins for reads until the user logs in; set() then updates BOTH the in-memory
 * override and the on-disk store. Previously the fresh token lived only in a
 * StaticTokenStore, so "✓ Logged in" evaporated with the process and every
 * later run re-read the stale AETHER_TOKEN and got 401s at model-select —
 * the exact bug in PR #47.
 */
export class EnvOverrideTokenStore implements TokenStore {
  constructor(
    private override: string,
    private readonly disk: TokenStore,
  ) {}
  async get(): Promise<string | null> {
    return this.override || this.disk.get();
  }
  async set(token: string): Promise<void> {
    this.override = token;
    await this.disk.set(token);
  }
  /** Automatic refresh of an embedded session stays in-process: the desktop
   * app owns AETHER_TOKEN, and a background rotation must not overwrite the
   * standalone CLI's independent on-disk login. */
  async update(token: string): Promise<void> {
    this.override = token;
  }
  async clear(): Promise<void> {
    this.override = "";
    await this.disk.clear();
  }
}

/**
 * In-memory token store for embedded/headless use — a parent process (desktop,
 * web server) injects the user's session_token directly (e.g. AETHER_TOKEN)
 * instead of reading the keychain/file. This is how surfaces route through the
 * core without sharing the CLI's on-disk token.
 */
export class StaticTokenStore implements TokenStore {
  constructor(private token: string) {}
  async get(): Promise<string | null> {
    return this.token || null;
  }
  async set(token: string): Promise<void> {
    this.token = token;
  }
  async clear(): Promise<void> {
    this.token = "";
  }
}

interface LoginResponseBody {
  authenticated: boolean;
  session_token?: string;
  commitment_hash?: string;
  reason?: string;
  plan?: string;
}

export interface LoginResult {
  plan?: string;
  commitmentHash?: string;
}

/** Authenticate with username/password against /auth/login; store the token. */
export async function loginWithPassword(
  baseUrl: string,
  store: TokenStore,
  creds: { username: string; password: string; licenseKey?: string },
): Promise<LoginResult> {
  if (!isCredentialSafeUrl(baseUrl)) throw new Error("login refused: insecure transport");
  // Bounded on its own: this runs before any token exists, so it can't go
  // through ApiClient.request()'s default timeout — without one, a stalled
  // /auth/login response would hang the headless `--username/--password` flow
  // (login.ts's CI/scripts path) forever with no other cancellation mechanism.
  // Shares AETHER_REQUEST_TIMEOUT_MS with ApiClient so one env var controls
  // both; 0 (explicitly disabled) is honored rather than passing a
  // zero-length AbortSignal.timeout(), which would abort immediately.
  const timeoutMs = defaultRequestTimeoutMs();
  const res = await fetch(baseUrl.replace(/\/$/, "") + LOGIN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: creds.username,
      password: creds.password,
      license_key: creds.licenseKey ?? null,
    }),
    ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  let body: LoginResponseBody;
  try {
    body = (await res.json()) as LoginResponseBody;
  } catch {
    throw new Error(`login failed (HTTP ${res.status})`);
  }
  if (!res.ok || !body.authenticated || !body.session_token) {
    throw new Error(`login failed: ${body.reason ?? `HTTP ${res.status}`}`);
  }
  await store.set(body.session_token);
  const result: LoginResult = {};
  if (body.plan != null) result.plan = body.plan;
  if (body.commitment_hash != null) result.commitmentHash = body.commitment_hash;
  return result;
}
