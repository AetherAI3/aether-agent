# Aether Agent — Command Reference

Complete reference for every command, flag, slash command, and environment
variable. For a quick tour, see the [README](README.md).

```
aether [global flags] <command> [args]
aether [global flags] "<prompt>"        # bare prompt = one-shot chat
aether                                  # no args = interactive REPL
```

---

## Global flags

These apply to any command (parsed anywhere on the line).

| Flag | Type | Meaning |
|---|---|---|
| `--model <id>` | string | Force a model for this run (e.g. `--model opus`). |
| `--agent <id>` | string | Force an orchestrator (`neo`, `kronus`). |
| `--cwd <dir>` | string | Workspace directory for file context + edits (default: current dir). |
| `--json` | bool | Emit raw stream frames as JSON lines (machine mode). |
| `--audit` | bool | Print the chain-of-custody id inline after a turn. |
| `-y`, `--yes` | bool | Auto-confirm prompts (non-interactive). |
| `-h`, `--help` | bool | Print help and exit. |
| `-v`, `--version` | bool | Print version and exit. |

---

## Commands

### `aether` — interactive REPL
Opens a session. Type a prompt to chat; type `/` commands to control it (see
[Slash commands](#slash-commands)). `Ctrl-C` or `/exit` to leave.

### `aether "<prompt>"` — one-shot
Runs a single turn against your default (or `--model`) and streams the answer.
```bash
aether "explain what src/router.ts does"
aether --model opus "rewrite this function to be O(n)"
```

### `aether run <neo|kronus> "<task>"` — orchestrator
Hands a multi-step task to an orchestrator, which plans, fans out sub-agents,
and synthesizes. Streams task-level progress.
```bash
aether run neo "add pagination to the users endpoint and write tests"
aether run kronus "audit this service for race conditions and fix them"
```
> Orchestrators are gated to paid tiers. Neo is available on Solo+; Kronus on Pro+.

### `aether resume [id]` — replay a session
Replays a prior local coding session's transcript from `~/.aether-agent/logs/`.
With no id, resumes the most recent session.
```bash
aether resume                 # the latest session
aether resume <session-id>    # a specific session
aether agent --resume <id> "<task>"   # resume, then continue working
```
> Local-first: sessions are read from disk, so resume works offline. When you stop
> a coding run with Ctrl-C, the exact `aether agent --resume <id>` command is printed.

### `aether models [use <id>]` — list / pick a model
- `aether models` — list every model **and** orchestrator visible to your tier.
  `*` = your current default, `🔒` = locked on your plan, `cap N` = monthly UVT
  ceiling for that model on your tier.
- `aether models use <id>` — set your local default model/orchestrator.
```bash
aether models
aether models use sonnet
```

### `aether agents` — list orchestrators
Lists only the orchestrators (Neo / Kronus), filtered from the same catalog.

### `aether auth <subcommand>` — credentials
Modeled on GitHub's `gh auth`. One credential for the CLI, desktop, and web.
`aether login` / `aether logout` are aliases for `auth login` / `auth logout`.

| Subcommand | Does |
|---|---|
| `aether auth login` | Default: open `aethersystems.net/platform`, paste the CLI token. |
| `aether auth logout` | Clear the stored credential (best-effort server notify). |
| `aether auth status` | Show login state: token type (API token `aek_` vs session), masked token, base URL, tier. |
| `aether auth token` | Print the stored token (for scripts / CI). |
| `aether auth refresh` | Refresh a session token (API tokens don't expire). |

`auth login` flags:
| Flag | Meaning |
|---|---|
| *(none)* | Browser OAuth: open the platform, paste the token. |
| `--with-token` | Read the token from **stdin** (`aether auth login --with-token < token.txt`). |
| `--token <t>` | Store a token directly. |
| `--username <u> --password <p>` | Headless credential login. |
| `--license-key <k>` | Supply a license key alongside credentials. |
| `--no-browser` | Print the URL instead of opening a browser. |

### `aether audit [limit]` — recent receipts
Lists recent chain-of-custody entries for your account (default 50). Each row:
`timestamp · event · commitment_hash · order_id`.
```bash
aether audit 20
```

### `aether receipt <order_id>` — export proof
Exports the cryptographic proof package for one audit entry. Find ids with
`aether audit`.
```bash
aether receipt chat_8f3a...
```

### `aether config [show|get|set]` — local settings
Local settings, stored at `~/.config/aether/config.json`.
```bash
aether config                       # show all
aether config get defaultModel
aether config set defaultModel opus
aether config set permissionMode ask   # ask | auto | skip
aether config set autoApply true
```

| Key | Type | Meaning |
|---|---|---|
| `baseUrl` | string | Aether API base URL. |
| `defaultModel` | string | Model used when `--model` is omitted. |
| `permissionMode` | `ask`\|`auto`\|`skip` | Gate edits/commands: prompt every time, auto with confirm, or fully autonomous. |
| `autoApply` | bool | Apply streamed edits without a per-edit prompt. |
| `telemetry` | bool | Anonymous usage telemetry opt-in. |

---

## Slash commands (inside the REPL)

Type a prompt to chat; type `/` to drive the session. `/help` renders this same
set, grouped, inside the REPL. This table is the single source of truth — it
mirrors the live registry in `src/commands/slash.ts`.

### Session

| Command | Action |
|---|---|
| `/help` | Show the grouped command menu. |
| `/models` | List chat models (numbered; `›` current, `🔒` locked). |
| `/model <n\|id>` | Switch model — opens the picker with no arg. Restarts the session. |
| `/agents` | View active agent sessions (name, status, time, UVT, task). |
| `/agent <n\|id>` | Switch orchestrator (Neo / Kronus) — opens the picker with no arg. |
| `/tier` | Show your plan tier, default, and available counts. |
| `/audit [n]` | Recent chain-of-custody receipts. |
| `/doctor` | Diagnose setup: API base, auth state, server reachability. |
| `/clear` | Clear the screen. |
| `/mcp` | MCP server management (coming soon). |
| `/exit`, `/quit` | Leave the REPL. |

### Agent modes

Each starts an agent loop in the REPL.

| Command | Action |
|---|---|
| `/autonomous-execution <task>` | Execute a task end-to-end without per-step prompts. |
| `/subagent-driven-execution <task>` | Decompose a task and delegate to sub-agents. |
| `/self-review` | Review your own recent work. |
| `/recon <topic>` | Deep reconnaissance pass over the codebase. |
| `/plan <topic>` | Write an implementation plan. |
| `/writing-plans <topic>` | Write a plan to `.hermes/plans/`. |
| `/research <topic>` | Research → gather → summarize. |
| `/review` | Full project review + summary. |
| `/code-review` | Sweep: clean up + simplify. |
| `/writing-skills` | Author reusable skills. |

### Steering

| Command | Action |
|---|---|
| `/queue <task>` | Queue a task to run when the current one finishes. |
| `/steer <guidance>` | Mid-task steering applied on the next turn. |
| `/btw <note>` | Contextual side note (accumulates into context). |

### Context & limits

| Command | Action |
|---|---|
| `/pin <path> [reason]` | Force a file into persistent context across loops. |
| `/pin list` | List pinned files. |
| `/drop <path>` | Evict a file from context. |
| `/snapshot` | Save session state to disk. |
| `/snapshot resume [id]` | Reload a snapshot (cloud first, else local; lists with no id). |
| `/snapshot list` | List saved snapshots. |
| `/limit <uvt>` | Cap UVT spend for the session (`/limit off` to remove). |
| `/audit-receipt [n]` | Verified log of tool calls + UVT (local custody + server). |
| `/rollback [n]` | Revert the last n uncommitted filesystem changes (git-backed). |
| `/logs-view`, `/logs` | Interactive session log browser. |

### Goals & workflows

| Command | Action |
|---|---|
| `/goal <desc>` | Create a goal; the agent plans phases. |
| `/goal view [id]` | Show the goal chain + detail. |
| `/goal start\|pause\|resume\|cancel\|complete\|note` | Drive a goal's lifecycle. |
| `/goals [id]` | List goals, or view one by id. |
| `/workflow` | Workflow status. |
| `/workflow-templates` | List workflow templates. |
| `/workflow-template <n>` | Load a template. |

### Vault

| Command | Action |
|---|---|
| `/vault` | Vault status (note count). |
| `/vault-context` | Load vault context into the next agent turn. |
| `/vault-search <q>` | Search notes. |
| `/vault-recent [n]` | Most recent notes. |
| `/vault-project <name>` | Notes for a project. |
| `/vault-tag <tag>` | Notes by tag. |
| `/vault-tree` | Vault folder tree. |

### Orchestra

Requires an active orchestrator — switch with `/agent neo` or `/agent kronus` first.

| Command | Action |
|---|---|
| `/delegate <model> <task>` | Delegate a sub-task to a worker model. |
| `/tree` | Live orchestration hierarchy (workers, step, tokens, UVT). |
| `/broadcast "<msg>"` | Inject a directive to all sub-agents. |
| `/gather <id\|all>` | Merge completed sub-agent work to staging. |

---

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `AETHER_BASE_URL` | `https://api.aethersystems.net` | Overrides the config `baseUrl`. |
| `AETHER_LOGIN_URL` | `https://aethersystems.net/platform` | Page `aether auth login` opens. |
| `AETHER_TOKEN` | *(unset)* | Inject a session token (CI / headless / embedding). |
| `AETHER_CONFIG_DIR` | `~/.config/aether` | Config + token directory. |
| `AETHER_STREAM_TIMEOUT_MS` | `120000` | Stream open/idle timeout (ms). `0` disables it. |

See [`.env.example`](.env.example).

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Runtime error (network, server error, etc.). |
| `2` | Usage error (bad/missing arguments). |

---

## Embedding (library API)

```ts
import { createClient } from "aether-agent";
const aether = createClient({ baseUrl, token });

aether.chatStream(prompt, { model?, agent?, manualModel? })  // AsyncIterable<StreamFrame>
aether.catalog()                                             // { models, tier, default }
aether.login(username, password, licenseKey?)
aether.http                                                  // raw authed HTTP on the same route
```

Stream frames: `open` · `ping` · `reasoning` · `delta` · `usage` · `done` ·
`error`, plus orchestrator frames `task_start` · `task_progress` · `task_done` ·
`task_failed` · `task_blocked` · `project_done`. Unknown frame types are ignored.
