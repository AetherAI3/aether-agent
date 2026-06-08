# Aether Code — Command Reference

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
Replays a prior local coding session's transcript from `~/.aether-code/logs/`.
With no id, resumes the most recent session.
```bash
aether resume                 # the latest session
aether resume <session-id>    # a specific session
aether code --resume <id> "<task>"   # resume, then continue working
```
> Local-first: sessions are read from disk, so resume works offline. When you stop
> a coding run with Ctrl-C, the exact `aether code --resume <id>` command is printed.

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

| Command | Action |
|---|---|
| `/models` | List chat models (numbered; `›` current, `🔒` locked). |
| `/model <n\|id>` | Switch model by list number or id. |
| `/agents` | List orchestrators (Neo / Kronus). |
| `/agent <n\|id>` | Switch to an orchestrator. |
| `/tier` | Show your plan tier, default, and available counts. |
| `/audit [n]` | Recent chain-of-custody receipts. |
| `/clear` | Clear the screen. |
| `/help` | List slash commands. |
| `/exit`, `/quit` | Leave the REPL. |

---

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `AETHER_BASE_URL` | `https://api.aethersystems.net` | Overrides the config `baseUrl`. |
| `AETHER_LOGIN_URL` | `https://aethersystems.net/platform` | Page `aether auth login` opens. |
| `AETHER_TOKEN` | *(unset)* | Inject a session token (CI / headless / embedding). |
| `AETHER_CONFIG_DIR` | `~/.config/aether` | Config + token directory. |

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
