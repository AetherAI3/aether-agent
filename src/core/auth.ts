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
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { configDir } from "./config.js";
import { LOGIN_PATH } from "./transport.js";

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** File-backed token store (0600). Fallback until keychain is wired. */
export class FileTokenStore implements TokenStore {
  private path = join(configDir(), ".token");

  async get(): Promise<string | null> {
    if (!existsSync(this.path)) return null;
    const t = readFileSync(this.path, "utf8").trim();
    return t || null;
  }

  async set(token: string): Promise<void> {
    // mkdirSync is required here: on a fresh machine nothing else creates the
    // config dir before first login, so omitting this throws ENOENT (verified
    // bug on HEAD's side). Creating dir 0700 / file 0600 AT CREATION (rather
    // than write-then-chmod) closes the race window where the token would
    // otherwise be briefly world-readable. The trailing chmod below is
    // belt-and-suspenders for a pre-existing file written by an older build
    // at a looser mode; it's a no-op on filesystems without POSIX modes.
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, token, { encoding: "utf8", mode: 0o600 });
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
 * Token store for a running CLI process, choosing the source by environment.
 *
 * An injected `AETHER_TOKEN` — how the desktop app (and the web server) embed a
 * user's EXISTING session into the spawned CLI — WINS over the on-disk file
 * store, so a user already signed into AetherCloud who opens a terminal is
 * authenticated as that same account and is NEVER asked to re-run
 * `aether auth login`. With no env token (a standalone CLI user), it falls back
 * to the file store, so the normal login flow is unaffected. An empty/whitespace
 * value counts as unset. Mirrors AetherClient's embedded-token resolution so the
 * interactive REPL and the universal chat client agree on auth.
 */
export function tokenStoreFromEnv(env: NodeJS.ProcessEnv = process.env): TokenStore {
  const injected = (env["AETHER_TOKEN"] ?? "").trim();
  return injected ? new StaticTokenStore(injected) : defaultTokenStore();
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
  const res = await fetch(baseUrl.replace(/\/$/, "") + LOGIN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: creds.username,
      password: creds.password,
      license_key: creds.licenseKey ?? null,
    }),
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
