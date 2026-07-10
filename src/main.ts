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
import { VERSION } from "./version.js";
import { cmdGithub } from "./commands/github.js";
import { cmdVault } from "./commands/vault.js";
import { cmdWorkflow } from "./commands/workflow.js";
import { cmdImage, cmdVideo } from "./commands/media.js";
import { cmdOutput } from "./commands/output.js";
import { renderCliHelp } from "./commands/cli_registry.js";

/** Coerce a parsed flag value to string | undefined. */
const sf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

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
      apply: { type: "boolean", default: false },
      deep: { type: "boolean", default: false },
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
    const target = cmd === "help" ? positionals[1] : cmd;
    process.stdout.write(renderCliHelp(target));
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
    local: Boolean(values["local"]),
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
    case "memory": {
      const { cmdMemory } = await import("./commands/memory.js");
      return cmdMemory(ctx, rest, { apply: Boolean(values["apply"]) });
    }
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
    case "doctor": {
      const { cmdDoctor } = await import("./commands/doctor.js");
      return cmdDoctor(ctx, rest, { deep: Boolean(values["deep"]) });
    }
    case "mcp": {
      const { cmdMcp } = await import("./commands/mcp.js");
      return cmdMcp(ctx, rest);
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
