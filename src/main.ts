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
import { ALL_CLI_COMMANDS, CLI_PARSE_OPTIONS, findDispatchedCliCommand, renderCliHelp } from "./commands/cli_registry.js";
import { commandFlags } from "./core/command_dispatch.js";
import { commandNames, suggestRegisteredCommand } from "./core/command_registry.js";

/** Coerce a parsed flag value to string | undefined. */
const sf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// Real top-level subcommand names, sourced from the union of the switch's
// registry and the dispatch table (cli_registry.ts) — the same registries the
// dispatch is cross-checked against — so this can never drift from the actual
// dispatched subcommands.
const TOP_LEVEL_COMMAND_NAMES = commandNames(ALL_CLI_COMMANDS);

/**
 * Suggestion for a lone bare token at the top level (`aether auht`). Exact
 * matches are never guarded (the switch handles them); short tokens (≤5
 * chars) only match at distance 1, longer at ≤2 — keeps `auht`→auth and
 * `moddels`→models while letting an unrelated word like `hello` flow to chat.
 */
function suggestTopLevel(token: string): string | null {
  if (TOP_LEVEL_COMMAND_NAMES.includes(token)) return null;
  const max = token.length <= 5 ? 1 : 2;
  return suggestRegisteredCommand(token, TOP_LEVEL_COMMAND_NAMES, max);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    // Globals plus every dispatch-table command's flags — one flat namespace,
    // validated for collisions at registry load (cli_registry.ts).
    options: CLI_PARSE_OPTIONS,
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
    all: Boolean(values["all"]),
    ...(typeof values["out"] === "string" ? { out: values["out"] as string } : {}),
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

  // Dispatch table first (cli_registry.ts DISPATCH_COMMANDS). A table entry is
  // reachable because it *is* the dispatch — not because a switch case below
  // happens to mention the same string. That matters most in the failure
  // direction: an unmatched name falls through to cmdChat, so a missed wiring
  // would quietly bill a chat turn for the command word.
  if (typeof cmd === "string") {
    const dispatched = findDispatchedCliCommand(cmd);
    if (dispatched) return (await dispatched.load())(ctx, rest, commandFlags(dispatched, values));
  }

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
    case "skills": {
      const { cmdSkills } = await import("./commands/skills.js");
      return cmdSkills(ctx, rest, {
        scope: sf(values["scope"]),
        all: Boolean(values["all"]),
        ci: Boolean(values["ci"]),
        json: Boolean(values["json"]),
        ...(sf(values["junit"]) != null ? { junit: sf(values["junit"])! } : {}),
      });
    }
    case "capabilities": {
      const { cmdCapabilities } = await import("./commands/capabilities.js");
      return cmdCapabilities(ctx, rest, { available: Boolean(values["available"]) });
    }
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
    case "support-bundle": {
      const { cmdSupportBundle } = await import("./commands/support_bundle.js");
      return cmdSupportBundle(ctx, rest);
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
    case "review": {
      const { cmdReview } = await import("./commands/review.js");
      return cmdReview(ctx, rest, {
        files: sf(values["files"]),
        hunks: sf(values["hunks"]),
        message: sf(values["message"]),
        base: sf(values["base"]),
        testCmd: sf(values["test-cmd"]),
        approve: sf(values["approve"]),
        all: Boolean(values["all"]),
        yes: flags.yes,
        json: flags.json,
      });
    }
    case "ship": {
      const { cmdShip } = await import("./commands/ship.js");
      return cmdShip(ctx, rest, {
        title: sf(values["title"]),
        body: sf(values["body"]),
        base: sf(values["base"]),
        approve: sf(values["approve"]),
        yes: flags.yes,
        json: flags.json,
      });
    }
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
      const { cmdResume, cmdResumeExport, cmdResumeList } = await import("./commands/resume.js");
      // `aether resume list` is an alias for `aether sessions` — one listing,
      // reachable from the command people already know. (Lane AA-CONT-04.)
      if (rest[0] === "list") return cmdResumeList(ctx, Boolean(values["all"]));
      return rest[0] === "export"
        ? cmdResumeExport(ctx, rest[1] ?? "", sf(values["out"]))
        : cmdResume(ctx, rest[0] ?? "");
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
