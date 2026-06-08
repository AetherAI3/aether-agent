#!/usr/bin/env node
// Aether Code — CLI entry. Parses global flags, builds the AppContext, and
// dispatches to a command. The CLI is the front door; all enforcement (UVT)
// and signing (Aether audit) happen server-side on Aether's servers.

import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { loadConfig } from "./core/config.js";
import { defaultTokenStore } from "./core/auth.js";
import { ApiClient } from "./core/transport.js";
import type { AppContext, GlobalFlags } from "./core/context.js";
import { cmdChat } from "./commands/chat.js";
import { cmdLogin, cmdLogout, type LoginOpts } from "./commands/login.js";
import { cmdAuth } from "./commands/auth.js";
import { cmdModels, cmdAgents } from "./commands/models.js";
import { cmdRun } from "./commands/run.js";
import { cmdCode } from "./commands/code.js";
import { VERSION } from "./version.js";
import { cmdGithub } from "./commands/github.js";

/** Coerce a parsed flag value to string | undefined. */
const sf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const HELP = `Aether Code — an open-source coding agent for your terminal.

Usage:
  aether                       Start an interactive coding REPL
  aether "<prompt>"            One-shot coding turn
  aether code "<task>"         Autonomous coding agent (cloud brain, UVT-metered)
  aether code --local "<task>" Same agent, local Python/Ollama brain (offline)
  aether resume [id]           Replay a local session (latest if no id)
  aether code --resume <id>    Resume a paused coding session
  aether run <neo|kronus> "<task>"   Stream an orchestrator run
  aether models [use <id>]     List models + orchestrators / set default
  aether agents                List orchestrators (Neo / Kronus)
  aether auth login            Authorize via browser (or --with-token / --token)
  aether auth status           Show login state    aether auth token   Print token
  aether auth refresh          Refresh a session   aether auth logout  Log out
  aether github connect        Link GitHub so backend agents can work your repos
  aether github status         Show GitHub link    aether github disconnect  Unlink
  aether audit [limit]         Recent audit chain-of-custody trail
  aether receipt <order_id>    Export the proof package for an audit entry
  aether config [show|get <k>|set <k> <v>]

Global flags:
  --model <id>   Force a model     --agent <id>   Force an orchestrator
  --cwd <dir>    Workspace dir      --json         Emit raw frames as JSON
  --audit        Show signature     -y, --yes      Auto-confirm prompts
  -h, --help     This help          -v, --version  Print version

aether code flags:
  --local        Use the local brain (Python/Ollama) instead of the cloud
  --pool <gb>    Context pool size in GB (status-bar reach = pool x 233M)
  --effort <t>   Effort tier: LOW | MED | MAX | ULTRA | CODEPRO
  --test-cmd <c> Command the grounding gate runs (default: pytest -q)
  --quiet        Plain output (strip the personality frames)
  --interactive  Pause at each stage boundary to type a steer (TTY only)
  --no-log       Disable the local session log (~/.aether-code/logs)
  --worktree     Run in a fresh git worktree on an auto-named branch (isolated)
  --repo <o/n>   Work on a GitHub repo (clones via your gh/git auth, worktrees it)
  --swarm <N>    N-agent swarm (gated; local-only; see docs/SWARM_PLAN.md)

Local model tiers (--model, via Ollama):
  small (universal) qwen2.5-coder:7b   ~4.7GB · fits 8GB GPU · best small tools
  gemma option      gemma3:4b          ~3.3GB · gemma3n:e4b for the efficient e4b
  depth             qwen3-coder:30b    needs ~24GB RAM/VRAM
  (NOTE: 'gemma4' is not a real Ollama tag. profiles set per-model sampling.)
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
      // `aether code` flags:
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
  const tokens = defaultTokenStore();
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
    case "login":
      return cmdLogin(ctx, loginOpts);
    case "logout":
      return cmdLogout(ctx);
    case "audit": {
      const { cmdAudit } = await import("./commands/audit.js");
      return cmdAudit(ctx, rest);
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
    case "code":
      return cmdCode(ctx, rest.join(" "), {
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
    case "resume": {
      const { cmdResume } = await import("./commands/resume.js");
      return cmdResume(ctx, rest[0] ?? "");
    }
    case "chat":
      return cmdChat(ctx, rest.join(" "));
    default:
      // Bare prompt: `aether "fix the bug"` — cmd is the first prompt word.
      return cmdChat(ctx, [cmd, ...rest].join(" "));
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
