// `aether auth <login|logout|status|token|refresh>` — GitHub-gh-style auth.
// One credential authenticates the CLI, desktop, and web against the Aether
// account. Logging in mints/pastes an API token (or browser OAuth via the
// platform); `status` shows who you are; `token` prints it for scripts.

import type { AppContext } from "../core/context.js";
import { cmdLogin, cmdLogout, type LoginOpts } from "./login.js";
import { MODELS_PATH, REFRESH_PATH } from "../core/transport.js";

/** A long-lived API token (PAT) starts with `aek_`; otherwise it's a session token. */
export function isApiToken(token: string | null | undefined): boolean {
  return typeof token === "string" && token.startsWith("aek_");
}

function mask(t: string): string {
  return t.length <= 12 ? "•".repeat(Math.max(4, t.length)) : `${t.slice(0, 8)}…${t.slice(-4)}`;
}

export async function cmdAuth(
  ctx: AppContext,
  argv: string[],
  loginOpts: LoginOpts,
): Promise<number> {
  const sub = (argv[0] ?? "status").toLowerCase();
  switch (sub) {
    case "login":
      return cmdLogin(ctx, loginOpts);
    case "logout":
      return cmdLogout(ctx);
    case "status":
      return authStatus(ctx);
    case "token":
      return authToken(ctx);
    case "refresh":
      return authRefresh(ctx);
    case "help":
      printAuthHelp();
      return 0;
    default:
      process.stderr.write(`unknown: aether auth ${sub}\n`);
      printAuthHelp();
      return 2;
  }
}

function printAuthHelp(): void {
  process.stdout.write(
    [
      "aether auth login    Authorize via browser (or --with-token / --token)",
      "aether auth logout   Clear the stored credential",
      "aether auth status   Show who you're logged in as",
      "aether auth token    Print the stored token (for scripts)",
      "aether auth refresh  Refresh a session token",
      "",
    ].join("\n"),
  );
}

async function authStatus(ctx: AppContext): Promise<number> {
  const t = await ctx.tokens.get();
  if (!t) {
    process.stdout.write("Not logged in.\n  Run: aether auth login\n");
    return 1;
  }
  const kind = isApiToken(t) ? "API token" : "session token";
  process.stdout.write(`aethersystems.net\n  ✓ logged in (${kind})  ${mask(t)}\n  api: ${ctx.cfg.baseUrl}\n`);
  try {
    const cat = await ctx.api.getJson<{ tier?: string; default?: string }>(MODELS_PATH);
    if (cat.tier) {
      process.stdout.write(`  tier: ${cat.tier}${cat.default ? `  default: ${cat.default}` : ""}\n`);
    }
    return 0;
  } catch {
    process.stderr.write("  ⚠ token not accepted by the server — run: aether auth login\n");
    return 1;
  }
}

async function authToken(ctx: AppContext): Promise<number> {
  const t = await ctx.tokens.get();
  if (!t) {
    process.stderr.write("Not logged in.\n");
    return 1;
  }
  process.stdout.write(t + "\n");
  return 0;
}

async function authRefresh(ctx: AppContext): Promise<number> {
  const t = await ctx.tokens.get();
  if (!t) {
    process.stderr.write("Not logged in. Run: aether auth login\n");
    return 1;
  }
  if (isApiToken(t)) {
    process.stdout.write("API tokens don't expire — manage them on the platform. Nothing to refresh.\n");
    return 0;
  }
  try {
    const r = await ctx.api.postJson<{ session_token?: string }>(REFRESH_PATH, {});
    if (r.session_token) {
      await ctx.tokens.set(r.session_token);
      process.stdout.write("Session refreshed.\n");
      return 0;
    }
    process.stderr.write("refresh failed\n");
    return 1;
  } catch (err) {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
