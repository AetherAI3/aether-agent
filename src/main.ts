#!/usr/bin/env node
// Aether Agent — CLI entry. Parses global flags, builds the AppContext, and
// dispatches to a command. The CLI is the front door; all enforcement (UVT)
// and signing (Aether audit) happen server-side on Aether's servers.

import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { loadConfig } from "./core/config.js";
import { tokenStoreFromEnv } from "./core/auth.js";
import { ApiClient } from "./core/transport.js";
import type { AppContext, GlobalFlags } from "./core/context.js";
import { cmdChat } from "./commands/chat.js";
import { cmdLogin, cmdLogout, type LoginOpts } from "./commands/login.js";
import { cmdAuth } from "./commands/auth.js";
import { cmdModels, cmdAgents } from "./commands/models.js";
import { cmdRun } from "./commands/run.js";
import { cmdCode } from "./commands/code.js";
import { errTheme } from "./ui/theme.js";
// VERSION is imported ONCE from the generated version.js — main.ts must never
// hardcode a duplicate version string that can drift from package.json.
import { VERSION } from "./version.js";
import { cmdGithub } from "./commands/github.js";
import { cmdVault } from "./commands/vault.js";
import { cmdWorkflow } from "./commands/workflow.js";
import { cmdImage, cmdVideo } from "./commands/media.js";
import { cmdOutput } from "./commands/output.js";

/** Coerce a parsed flag value to string | undefined. */
const sf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// Real top-level subcommands (mirrors the switch below). Kept local rather
// than re-exported from slash_registry.ts: that registry's suggestCommand()
// is scoped to slash-command vocabulary (/model, /help, ...), a different
// namespace than these bare `aether <cmd>` words — conflating them would let
// e.g. "aether model" suggest a slash command that isn't a valid subcommand.
const TOP_LEVEL_COMMANDS = [
  "auth", "github", "vault", "workflow", "image", "video", "output", "login",
  "logout", "audit", "mcp", "models", "agents", "run", "receipt", "config",
  "agent", "code", "resume", "chat", "help",
];

/** Bounded Levenshtein — bails early past `max` (rows are monotonic in min). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! : 1 + Math.min(prev[j - 1]!, prev[j]!, cur[j - 1]!);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Suggestion for a lone bare token at the top level (`aether auht`). Exact
 * matches are never guarded (the switch handles them); short tokens (≤5
 * chars) only match at distance 1, longer at ≤2 — keeps `auht`→auth and
 * `moddels`→models while letting an unrelated word like `hello` flow to chat.
 */
function suggestTopLevel(token: string): string | null {
  if (TOP_LEVEL_COMMANDS.includes(token)) return null;
  const max = token.length <= 5 ? 1 : 2;
  let best: string | null = null;
  let bestD = max + 1;
  for (const cand of TOP_LEVEL_COMMANDS) {
    const d = editDistance(token, cand, bestD);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return bestD <= max ? best : null;
}

const HELP = `Aether Agent — an open-source coding agent for your terminal.

Local-first: when you're signed in, turns run on the cloud brain (Aether API,
UVT-metered, signed). When you're NOT signed in, turns run fully offline on a
local Ollama brain — no account, no network. Override with AETHER_BACKEND or
'aether config set backend auto|local|cloud' (default: auto).

Usage:
  aether                       Start an interactive coding REPL (local-first)
  aether "<prompt>"            One-shot coding turn (cloud if authed, else local)
  aether chat "<prompt>"       Same, explicit (bypasses top-level typo-matching)
  aether agent "<task>"         Autonomous coding agent (cloud when signed in)
  aether agent --local "<task>" Force the local Python/Ollama brain (offline)
  aether resume [id]           Replay a local session (latest if no id)
  aether agent --resume <id>    Resume a paused coding session
  aether run <neo|kronus> "<task>"   Stream an orchestrator run
  aether models [use <id>]     List models + orchestrators / set default
  aether agents                List orchestrators (Neo / Kronus)
  aether auth login            Authorize via browser (or --with-token / --token)
  aether auth status           Show login state    aether auth token   Print token
  aether auth refresh          Refresh a session   aether auth logout  Log out
  aether github connect        Link GitHub so backend agents can work your repos
  aether github status         Show GitHub link    aether github disconnect  Unlink
  aether vault list              List vault files/folders
  aether vault search <query>    Full-text search vault notes
  aether vault context           Show vault snapshot
  aether vault status            Vault health check
  aether vault <sub>             (see 'aether vault help' for all commands)
  aether workflow new <desc>    Generate a workflow from intent
  aether workflow templates     List built-in workflow templates
  aether workflow status        Workflow dashboard
  aether workflow <sub>         (see 'aether workflow help' for all commands)
  aether image "<prompt>" [--model] [--aspect] [--count] [--4k] [--vector] [--i]
  aether video "<prompt>" [--model] [--duration] [--1080p] [--audio] [--i]
  aether image models              aether video models
  aether output                    Show recent 10 generations
  aether output open <n>           Open generation in viewer
  aether mcp                   Manage MCP servers (connect, add, repair)
  aether audit [limit]         Recent audit chain-of-custody trail
  aether receipt <order_id>    Export the proof package for an audit entry
  aether config [show|get <k>|set <k> <v>]
  aether config set backend auto|local|cloud   Pick the brain (default: auto)

Global flags:
  --model <id>   Force a model     --agent <id>   Force an orchestrator
  --cwd <dir>    Workspace dir      --json         Emit raw frames as JSON
  --audit        Show signature     -y, --yes      Auto-confirm prompts
  -h, --help     This help          -v, --version  Print version

aether agent flags:
  --local        Use the local brain (Python/Ollama) instead of the cloud
  --pool <gb>    Context pool size in GB (status-bar reach = pool x 233M)
  --effort <t>   Effort tier: LOW | MED | MAX | ULTRA | CODEPRO
  --test-cmd <c> Command the grounding gate runs (default: pytest -q)
  --quiet        Plain output (strip the personality frames)
  --interactive  Pause at each stage boundary to type a steer (TTY only)
  --no-log       Disable the local session log (~/.aether-agent/logs)
  --worktree     Run in a fresh git worktree on an auto-named branch (isolated)
  --repo <o/n>   Work on a GitHub repo (clones via your gh/git auth, worktrees it)
  --swarm <N>    N-agent swarm (not enabled yet; will be local-only)

Local model tiers (--model, via Ollama):
  small (universal) qwen2.5-coder:7b   ~4.7GB · fits 8GB GPU · best small tools
  gemma option      gemma3:4b          ~3.3GB · gemma3n:e4b for the efficient e4b
  depth             qwen3-coder:30b    needs ~24GB RAM/VRAM
  (NOTE: 'gemma4' is not a real Ollama tag. profiles set per-model sampling.)

Agent tools (same set, local and cloud):
  read_file · write_file · run_shell · run_tests · repo_search · git_commit
  web_search   Search the web (DuckDuckGo, no key) for docs/answers mid-task
  web_fetch    Read a web page as text (SSRF-guarded: no localhost/private IPs)
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      model: { type: "string" },
      agent: { type: "string" },
      cwd: { type: "string" },
      token: { type: "string" },
      username: { type: "string" },
      password: { type: "string" },
      "license-key": { type: "string" },
      "with-token": { type: "boolean", default: false },
      "no-browser": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      audit: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      // `aether agent` flags:
      local: { type: "boolean", default: false },
      pool: { type: "string" },
      effort: { type: "string" },
      "test-cmd": { type: "string" },
      quiet: { type: "boolean", default: false },
      interactive: { type: "boolean", default: false },
      "no-log": { type: "boolean", default: false },
      worktree: { type: "boolean", default: false },
      repo: { type: "string" },
      swarm: { type: "string" },
      resume: { type: "string" },
    },
  });

  if (values["version"]) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }
  const cmd = positionals[0];
  if (values["help"] || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  const cfg = loadConfig();
  // Embedded launch (desktop/web sets AETHER_TOKEN) authenticates as that session
  // with no re-login; standalone CLI use falls back to the on-disk token store.
  const tokens = tokenStoreFromEnv();
  const api = new ApiClient(cfg.baseUrl, tokens);
  const flags: GlobalFlags = {
    model: typeof values["model"] === "string" ? values["model"] : undefined,
    agent: typeof values["agent"] === "string" ? values["agent"] : undefined,
    json: Boolean(values["json"]),
    audit: Boolean(values["audit"]),
    yes: Boolean(values["yes"]),
    cwd: typeof values["cwd"] === "string" ? (values["cwd"] as string) : process.cwd(),
  };
  // y/N confirmation for destructive prompts (e.g. switching model mid-session).
  // `--yes` short-circuits. Injected on the context so commands stay testable.
  const confirm = (q: string): Promise<boolean> =>
    flags.yes
      ? Promise.resolve(true)
      : new Promise((res) => {
          const rl = createInterface({ input: process.stdin, output: process.stderr });
          rl.question(q, (a) => {
            rl.close();
            res(/^y(es)?$/i.test(a.trim()));
          });
        });
  const ctx: AppContext = { cfg, api, tokens, flags, confirm };

  const loginOpts: LoginOpts = {
    token: sf(values["token"]),
    username: sf(values["username"]),
    password: sf(values["password"]),
    licenseKey: sf(values["license-key"]),
    withToken: Boolean(values["with-token"]),
    noBrowser: Boolean(values["no-browser"]),
  };

  const rest = positionals.slice(1);
  switch (cmd) {
    case undefined:
      return cmdChat(ctx, "");
    case "auth":
      return cmdAuth(ctx, rest, loginOpts);
    case "github":
      return cmdGithub(ctx, rest, { noBrowser: Boolean(values["no-browser"]) });
    case "vault":
      return cmdVault(ctx, rest);
    case "workflow":
      return cmdWorkflow(ctx, rest);
    case "image":
    case "img":
      return cmdImage(ctx, rest);
    case "video":
    case "vid":
      return cmdVideo(ctx, rest);
    case "output":
    case "out":
      return cmdOutput(ctx, rest);
    case "login":
      return cmdLogin(ctx, loginOpts);
    case "logout":
      return cmdLogout(ctx);
    case "audit": {
      const { cmdAudit } = await import("./commands/audit.js");
      return cmdAudit(ctx, rest);
    }
    case "mcp": {
      const { cmdMcp } = await import("./commands/mcp.js");
      return cmdMcp(ctx);
    }
    case "models":
      return cmdModels(ctx, rest);
    case "agents":
      return cmdAgents(ctx);
    case "run":
      return cmdRun(ctx, rest[0] ?? "", rest.slice(1).join(" "));
    case "receipt": {
      const { cmdReceipt } = await import("./commands/receipt.js");
      return cmdReceipt(ctx, rest[0] ?? "");
    }
    case "config": {
      const { cmdConfig } = await import("./commands/config.js");
      return cmdConfig(ctx, rest);
    }
    case "agent":
    case "code": {
      const task = rest.join(" ");
      // No task and not resuming → open the persistent interactive agent REPL
      // (chat bar ready for the first question), Claude Code style.
      if (!task && !sf(values["resume"])) return cmdChat(ctx, "");
      return cmdCode(ctx, task, {
        local: Boolean(values["local"]),
        pool: Number(sf(values["pool"]) ?? "5") || 5,
        effort: sf(values["effort"]),
        testCmd: sf(values["test-cmd"]),
        quiet: Boolean(values["quiet"]),
        interactive: Boolean(values["interactive"]),
        noLog: Boolean(values["no-log"]),
        worktree: Boolean(values["worktree"]),
        repo: sf(values["repo"]),
        swarm: Number(sf(values["swarm"]) ?? "1") || 1,
        resume: sf(values["resume"]),
      });
    }
    case "resume": {
      const { cmdResume } = await import("./commands/resume.js");
      return cmdResume(ctx, rest[0] ?? "");
    }
    case "chat":
      return cmdChat(ctx, rest.join(" "));
    default: {
      // Typo guard (narrowed per LOOP-19 arena): fires ONLY on exactly one
      // bare command-shaped token a Damerau edit away from a real subcommand —
      // `aether auht` should not become a paid chat call about "auht". Multi-
      // word prompts and non-matching words flow to chat exactly as before.
      if (rest.length === 0 && typeof cmd === "string" && /^[a-z][a-z-]*$/.test(cmd)) {
        const near = suggestTopLevel(cmd);
        if (near) {
          process.stderr.write(
            `${errTheme.red("✗")} unknown command: ${cmd} — did you mean: aether ${near}?\n` +
              errTheme.dim(`  ⤷ to send it as a chat prompt instead: aether chat ${cmd}`) +
              "\n",
          );
          return 2;
        }
      }
      // Bare prompt: `aether "fix the bug"` — cmd is the first prompt word.
      return cmdChat(ctx, [cmd, ...rest].join(" "));
    }
  }
}

// Graceful exit: process.exit() mid-teardown intermittently trips a libuv
// assertion on Windows after TLS fetches (UV_HANDLE_CLOSING, exit 127).
// Setting exitCode lets the loop drain (measured prompt — undici keep-alive
// does not hold it); the unref'd timer force-exits if some path ever leaks a
// ref'd handle, by which point teardown has settled and the race is gone.
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 2000).unref();
}

main(process.argv.slice(2))
  .then(finish)
  .catch((err) => {
    process.stderr.write(`\n${errTheme.red("✗")} ${err instanceof Error ? err.message : String(err)}\n`);
    finish(1);
  });
