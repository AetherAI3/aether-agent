// `aether auth <login|logout|status|token|refresh>` — GitHub-gh-style auth.
// One credential authenticates the CLI, desktop, and web against the Aether
// account. Logging in mints/pastes an API token (or browser OAuth via the
// platform); `status` shows who you are; `token` prints it for scripts.
//
// Bare `aether auth` (no subcommand) shows a branded status panel with a
// clickable login link.

import type { AppContext } from "../core/context.js";
import { cmdLogin, cmdLogout, type LoginOpts } from "./login.js";
import { MODELS_PATH, REFRESH_PATH } from "../core/transport.js";
import { HttpError } from "../core/errors.js";
import { isApiKeyToken } from "../core/auth.js";
import { box, titledBox, hyperlink, orange, green, darkBlue, brightWhite, lightBlue } from "../ui/box.js";
import { CLOUD } from "../ui/logo.js";
import { theme } from "../ui/theme.js";

/** A long-lived API token (PAT) starts with `aek_`; otherwise it's a session
 *  token. Thin wrapper so callers of THIS module keep importing `isApiToken`
 *  from here — the actual `aek_` prefix check is canonical in core/auth.ts's
 *  isApiKeyToken (shared with transport.ts's refreshSession). */
export function isApiToken(token: string | null | undefined): boolean {
  return isApiKeyToken(token);
}

function mask(t: string): string {
  return t.length <= 12 ? "\u2022".repeat(Math.max(4, t.length)) : `${t.slice(0, 8)}\u2026${t.slice(-4)}`;
}

// ── Shared cloud glyph (centered above the box) ──

const BOX_W = 64;
const CLOUD_W = CLOUD[1]!.length; // widest row

function centeredCloud(): string {
  const pad = Math.floor((BOX_W - CLOUD_W) / 2);
  const s = " ".repeat(Math.max(0, pad));
  return CLOUD.map((l) => s + theme.iceBlue(l)).join("\n");
}

// ── Branded status panel ──

// Exported so tests can render the panel directly against a fake AppContext
// without going through cmdAuth's stdout write.
export async function renderAuthBox(ctx: AppContext): Promise<string> {
  const t = await ctx.tokens.get();
  if (!t) return renderLoggedOut();

  // Fetch tier info for display
  let tier = "";
  let defaultModel = "";
  // A 401/403 here means the SERVER actively rejected this token (expired or
  // revoked session) — that is a different situation from "server
  // unreachable" and must not be swallowed the same way, or `status` would
  // claim "Authenticated" for a dead session (the stale-AETHER_TOKEN case PR
  // #47 fixed elsewhere). Any other failure (no HttpError, or a 5xx) is a
  // genuine network/server problem: keep the existing silent local-only
  // fallback for those.
  let sessionExpired = false;
  try {
    const cat = await ctx.api.getJson<{ tier?: string; default?: string }>(MODELS_PATH);
    tier = cat.tier ?? "";
    defaultModel = cat.default ?? "";
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      sessionExpired = true;
    }
    // Otherwise: server unreachable — still show what we know locally.
  }

  const kind = isApiToken(t) ? "API key" : "session token";
  const header = sessionExpired
    ? theme.yellow("⚠") + "  " + theme.bold("Aether Agent — Session expired")
    : theme.iceBlue("☁") + "  " + theme.bold("Aether Agent — Authenticated");
  const lines: string[] = [
    "",
    header,
    "",
    // No Account row: there is no account endpoint yet, and a hardcoded
    // "(fetching…)" that never resolves is a fake loading state (PR #47 UX).
    "  " + theme.dim("Token:") + "    " + theme.bold(mask(t)) + "  " + theme.dim(`(${kind})`),
    "  " + theme.dim("API:") + "      " + ctx.cfg.baseUrl.replace("https://", ""),
  ];

  if (sessionExpired) {
    lines.push(
      "",
      "  " + theme.yellow("Server rejected this token — sign in again:"),
      "  " + theme.bold(theme.cyan("aether auth login")),
    );
  } else {
    if (tier) {
      lines.push("  " + theme.dim("Tier:") + "     " + (tier === "free" ? theme.dim(tier) : theme.cyan(tier)));
    }
    if (defaultModel) {
      lines.push("  " + theme.dim("Default:") + "  " + defaultModel);
    }
  }

  lines.push(
    "",
    "  " + theme.dim("Commands:"),
    "  " + theme.dim("aether auth status") + "        Show this screen",
    "  " + theme.dim("aether auth token") + "         Print token (CI/scripts)",
    "  " + theme.dim("aether auth refresh") + "       Refresh session token",
    "  " + theme.dim("aether auth logout") + "        Sign out",
    "",
  );

  const title = sessionExpired ? "Session expired" : "Authenticated";
  return [centeredCloud(), "", titledBox(lines, title, { width: BOX_W })].join("\n");
}

// ── Logged-out welcome panel ──

const PLATFORM_URL = process.env["AETHER_LOGIN_URL"] ?? "https://aethersystems.net/platform/device";

function renderLoggedOut(): string {
  // Per-model brand colors
  const fleet = [
    orange("Claude"),
    green("GPT"),
    darkBlue("DeepSeek"),
    brightWhite("Kimi"),
    lightBlue("Gemma"),
    theme.dim("& more"),
  ].join(" \u00b7 ");

  const orch = theme.dim("Aether orchestrators: ") +
    theme.cyan("Neo") + theme.dim(", ") +
    theme.cyan("Kronus") + theme.dim(", & more");

  const lines = [
    "",
    theme.iceBlue("\u2601") + "  " + theme.bold("Welcome to Aether Agent"),
    "",
    theme.dim("Sign in to unlock the full model fleet:"),
    "  " + fleet,
    "  " + orch,
    "",
    "  " + theme.bold(theme.cyan("aether auth login")),
    "",
    theme.dim("Opens ") + hyperlink(PLATFORM_URL, theme.cyan("aethersystems.net/platform")),
    theme.dim("in your browser \u2192 click Approve \u2192 done."),
    "",
    "  " + theme.dim("No browser? Head to:"),
    "  " + hyperlink(PLATFORM_URL, theme.cyan("aethersystems.net/platform/device")),
    "",
    theme.dim("Quick:"),
    theme.dim("  aether auth login              Sign in via browser"),
    theme.dim("  aether auth login --no-browser      Print URL instead"),
    theme.dim("  aether auth --help             All auth commands"),
    "",
  ];

  return [centeredCloud(), "", box(lines, { width: BOX_W })].join("\n");
}

// ── Command dispatch ──

export async function cmdAuth(
  ctx: AppContext,
  argv: string[],
  loginOpts: LoginOpts,
): Promise<number> {
  const sub = (argv[0] ?? "").toLowerCase();
  switch (sub) {
    case "login":
      return cmdLogin(ctx, loginOpts);
    case "logout":
      return cmdLogout(ctx);
    case "status": {
      // LOOP-06: renderAuthBox's first move is a network round-trip to
      // /models (no cache to fall back on for the CLI's one-shot status
      // command), and nothing was written to stdout until the whole thing
      // resolved — up to DEFAULT_REQUEST_TIMEOUT_MS of silence on a slow
      // connection, "the REPL just looks hung" (the exact class PR #47 fixed
      // for slash.ts's catalog fetch). Match that convention here.
      process.stdout.write(theme.dim("checking session…\n"));
      const panel = await renderAuthBox(ctx);
      process.stdout.write(panel + "\n");
      return 0;
    }
    case "token":
      return authToken(ctx);
    case "refresh":
      return authRefresh(ctx);
    case "help":
      printAuthHelp();
      return 0;
    default: {
      // Bare `aether auth` — show the branded panel. Same LOOP-06 loading
      // line as the "status" branch above — this hits renderAuthBox's same
      // /models call.
      if (sub === "") {
        process.stdout.write(theme.dim("checking session…\n"));
        const panel = await renderAuthBox(ctx);
        process.stdout.write("\n" + panel + "\n\n");
        return 0;
      }
      process.stderr.write(`unknown: aether auth ${sub}\n`);
      printAuthHelp();
      return 2;
    }
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

// NOTE: HEAD had a plain-text authStatus() here; origin/main's `status` case
// now renders the branded renderAuthBox() panel instead (see cmdAuth above),
// which supersedes it — dropped to avoid dead code.
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
      process.stdout.write("✓ Session refreshed.\n");
      return 0;
    }
    process.stderr.write("✗ Refresh failed — try: aether auth login\n");
    return 1;
  } catch (err) {
    process.stderr.write(`\u2717 ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
