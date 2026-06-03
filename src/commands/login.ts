// `aether auth login` (alias: `aether login`) — authenticate with your Aether
// account. Default: open aethersystems.net/platform in the browser, then paste
// the CLI API token it shows. Other modes:
//   --with-token        read the token from stdin (gh-style: `... --with-token < f`)
//   --token <t>         store a token directly
//   --username/--password   headless credential login
//   --no-browser        print the URL instead of opening it

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { stdin, stdout } from "node:process";
import type { AppContext } from "../core/context.js";
import { loginWithPassword } from "../core/auth.js";
import { PLATFORM_URL, LOGOUT_PATH } from "../core/transport.js";

export interface LoginOpts {
  token?: string;
  username?: string;
  password?: string;
  licenseKey?: string;
  withToken?: boolean;
  noBrowser?: boolean;
}

export async function cmdLogin(ctx: AppContext, opts: LoginOpts): Promise<number> {
  // 1. Direct token.
  if (opts.token) {
    await ctx.tokens.set(opts.token);
    process.stdout.write("Token stored.\n");
    return 0;
  }
  // 2. Token piped on stdin.
  if (opts.withToken) {
    if (stdin.isTTY) {
      process.stderr.write("--with-token expects a token on stdin (e.g. `aether auth login --with-token < token.txt`)\n");
      return 2;
    }
    const t = (await readStdin()).trim();
    if (!t) {
      process.stderr.write("no token on stdin\n");
      return 2;
    }
    await ctx.tokens.set(t);
    process.stdout.write("Token stored.\n");
    return 0;
  }
  // 3. Headless username/password.
  if (opts.username && opts.password) {
    try {
      const credsBase = { username: opts.username, password: opts.password };
      const creds = opts.licenseKey ? { ...credsBase, licenseKey: opts.licenseKey } : credsBase;
      const r = await loginWithPassword(ctx.cfg.baseUrl, ctx.tokens, creds);
      process.stdout.write(`Logged in${r.plan ? ` (plan: ${r.plan})` : ""}.\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }
  // 4. Default: browser OAuth. Open the platform, paste the token back.
  process.stdout.write(
    `Authorize Aether at:\n  ${PLATFORM_URL}\n` +
      "Sign in, create a CLI token, and paste it below.\n\n",
  );
  if (!opts.noBrowser) openBrowser(PLATFORM_URL);
  const token = await promptHidden("paste token: ");
  if (!token) {
    process.stderr.write("no token entered\n");
    return 2;
  }
  await ctx.tokens.set(token);
  process.stdout.write("Logged in.\n");
  return 0;
}

export async function cmdLogout(ctx: AppContext): Promise<number> {
  const token = await ctx.tokens.get();
  if (token) {
    try {
      await ctx.api.postJson(LOGOUT_PATH, { session_token: token });
    } catch {
      // Best-effort server-side; always clear locally.
    }
  }
  await ctx.tokens.clear();
  process.stdout.write("Logged out.\n");
  return 0;
}

/** Open a URL in the default browser, cross-platform. Best-effort, non-fatal. */
function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Headless / no browser — the URL was already printed above.
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (c) => (data += c));
    stdin.on("end", () => resolve(data));
  });
}

function promptHidden(q: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
  rlAny._writeToOutput = (s: string): void => {
    if (s.includes(q)) stdout.write(q);
  };
  return new Promise((resolve) => {
    rl.question(q, (ans) => {
      stdout.write("\n");
      rl.close();
      resolve(ans.trim());
    });
  });
}
