// `aether auth login` (alias: `aether login`) — authenticate with your Aether
// account. Default: open aethersystems.net/platform in the browser, then paste
// the CLI API token it shows. Other modes:
//   --with-token        read the token from stdin (gh-style: `... --with-token < f`)
//   --token <t>         store a token directly
//   --username/--password   headless credential login
//   --no-browser        print the URL instead of opening it

import { stdin } from "node:process";
import type { AppContext } from "../core/context.js";
import { loginWithPassword } from "../core/auth.js";
import { LOGOUT_PATH } from "../core/transport.js";
import { requestDeviceCode, pollForToken } from "../core/device.js";
import { openBrowser } from "../core/browser.js";
import { theme } from "../ui/theme.js";

export interface LoginOpts {
  token?: string;
  username?: string;
  password?: string;
  licenseKey?: string;
  withToken?: boolean;
  noBrowser?: boolean;
}

/** After a successful login, flag a shell-level AETHER_TOKEN: it is re-read by
 * every NEW process and would shadow the token just stored — the classic
 * "login succeeded but the next command 401s" trap (PR #47). */
function warnEnvTokenShadow(): void {
  if ((process.env["AETHER_TOKEN"] ?? "").trim()) {
    const unsetCmd =
      process.platform === "win32"
        ? "Remove-Item Env:AETHER_TOKEN (PowerShell) / set AETHER_TOKEN= (cmd)"
        : "unset AETHER_TOKEN";
    process.stderr.write(
      theme.dim(
        "⚠ AETHER_TOKEN is set in this shell and overrides stored logins in new\n" +
          `  processes. If you keep getting 401s: ${unsetCmd}\n`,
      ),
    );
  }
}

export async function cmdLogin(ctx: AppContext, opts: LoginOpts): Promise<number> {
  // 1. Direct token.
  if (opts.token) {
    await ctx.tokens.set(opts.token);
    process.stdout.write("✓ Token stored.\n");
    warnEnvTokenShadow();
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
      process.stderr.write("✗ No token on stdin.\n");
      return 2;
    }
    await ctx.tokens.set(t);
    process.stdout.write("✓ Token stored.\n");
    warnEnvTokenShadow();
    return 0;
  }
  // 3. Headless username/password.
  if (opts.username && opts.password) {
    try {
      const credsBase = { username: opts.username, password: opts.password };
      const creds = opts.licenseKey ? { ...credsBase, licenseKey: opts.licenseKey } : credsBase;
      const r = await loginWithPassword(ctx.cfg.baseUrl, ctx.tokens, creds);
      process.stdout.write(`✓ Logged in${r.plan ? ` (plan: ${r.plan})` : ""}.\n`);
      warnEnvTokenShadow();
      return 0;
    } catch (err) {
      process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }
  // 4. Default: device authorization grant through the portal (RFC 8628).
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  let code;
  try {
    code = await requestDeviceCode(ctx.api);
  } catch (err) {
    process.stderr.write(
      `✗ could not start login: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `\nTo sign in, open:\n  ${code.verification_uri}\n` +
      `and enter the code:\n\n    ${code.user_code}\n\n`,
  );
  if (!opts.noBrowser) openBrowser(code.verification_uri_complete);
  process.stdout.write("Waiting for approval in your browser…\n");
  try {
    const token = await pollForToken(ctx.api, code, sleep);
    await ctx.tokens.set(token);
    process.stdout.write("✓ Logged in.\n");
    warnEnvTokenShadow();
    return 0;
  } catch (err) {
    process.stderr.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
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

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (c) => (data += c));
    stdin.on("end", () => resolve(data));
  });
}
