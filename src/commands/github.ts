// `aether github <status|connect|disconnect>` — link your GitHub account to
// Aether so backend coding agents can work on your repos (clone, branch, PR).
//
// Same web-canonical flow as `auth login`: connect opens the GitHub App install
// page in your browser, you pick repos + approve, the CLI polls until it lands.
// No GitHub token is ever stored locally — the backend mints short-lived
// install tokens on demand. `--no-browser` just prints the URL.

import type { AppContext } from "../core/context.js";
import { openBrowser } from "../core/browser.js";
import { fail as coreFail, errorMessage } from "../core/errors.js";
import {
  getGithubStatus,
  startGithubConnect,
  disconnectGithub,
  pollUntilConnected,
  type GithubStatus,
} from "../core/github.js";

export interface GithubOpts {
  noBrowser?: boolean;
}

export async function cmdGithub(ctx: AppContext, argv: string[], opts: GithubOpts = {}): Promise<number> {
  const sub = (argv[0] ?? "status").toLowerCase();
  switch (sub) {
    case "status":
      return githubStatus(ctx);
    case "connect":
      return githubConnect(ctx, opts);
    case "disconnect":
      return githubDisconnect(ctx);
    case "help":
      printGithubHelp();
      return 0;
    default:
      process.stderr.write(`unknown: aether github ${sub}\n`);
      printGithubHelp();
      return 2;
  }
}

function printGithubHelp(): void {
  process.stdout.write(
    [
      "aether github status      Show whether your GitHub account is linked",
      "aether github connect     Link GitHub (opens the App install page in your browser)",
      "aether github disconnect  Unlink GitHub (uninstalls the App)",
      "",
    ].join("\n"),
  );
}

function renderStatus(s: GithubStatus): string {
  if (!s.connected) return "GitHub: not linked.\n  Run: aether github connect\n";
  const scope = s.repo_selection === "all" ? "all repos" : "selected repos";
  const who = s.login ? ` (${s.login}${s.account_type ? `, ${s.account_type}` : ""})` : "";
  return `GitHub: ✓ linked${who}\n  scope: ${scope}\n`;
}

async function githubStatus(ctx: AppContext): Promise<number> {
  try {
    const s = await getGithubStatus(ctx.api);
    process.stdout.write(renderStatus(s));
    return s.connected ? 0 : 1;
  } catch (err) {
    return coreFail(err, "are you logged in? run: aether auth login");
  }
}

async function githubConnect(ctx: AppContext, opts: GithubOpts): Promise<number> {
  let installUrl: string;
  try {
    installUrl = await startGithubConnect(ctx.api);
  } catch (err) {
    process.stderr.write(`✗ could not start GitHub connect: ${errorMessage(err)}\n`);
    return 1;
  }
  process.stdout.write(`\nTo link GitHub, open:\n  ${installUrl}\n\n`);
  if (!opts.noBrowser) openBrowser(installUrl);
  process.stdout.write("Pick your repos and approve in the browser…\n");
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  try {
    const s = await pollUntilConnected(ctx.api, sleep);
    process.stdout.write(`✓ GitHub linked${s.login ? ` (${s.login})` : ""}.\n`);
    return 0;
  } catch (err) {
    return coreFail(err);
  }
}

async function githubDisconnect(ctx: AppContext): Promise<number> {
  try {
    await disconnectGithub(ctx.api);
    process.stdout.write("GitHub unlinked.\n");
    return 0;
  } catch (err) {
    return coreFail(err);
  }
}
