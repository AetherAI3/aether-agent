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
import { NotWiredError } from "./errors.js";
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
    // Create the dir 0700 and the file 0600 AT CREATION so the token is never
    // world-readable, even for the window between write and chmod. The trailing
    // chmod is belt-and-suspenders for a pre-existing file written by an older
    // build at a looser mode. chmod is a no-op on some Windows filesystems.
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

/**
 * Browser-based login. The CLI opens the account page; future builds may add
 * Aether; a CLI device/PKCE flow against that is future work. Use
 * loginWithPassword (or `--token`) until then.
 */
export async function deviceLogin(_baseUrl: string, _store: TokenStore): Promise<void> {
  throw new NotWiredError("browser OAuth login");
}
