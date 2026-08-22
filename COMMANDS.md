# Aether Agent — Command Reference

Complete reference for every command, flag, slash command, and environment
variable. For a quick tour, see the [README](README.md).

```
aether [global flags] <command> [args]
aether [global flags] "<prompt>"        # bare prompt = one-shot chat
aether                                  # no args = interactive REPL
```

## Registry indexes

<!-- Registry markers are checked against the declarative command registries. -->

<!-- CLI-COMMANDS:START -->
`help`, `agent`, `chat`, `resume`, `run`, `review`, `ship`, `models`, `agents`, `auth`,
`github`, `vault`, `workflow`, `memory`, `skills`, `capabilities`, `image`,
`video`, `output`, `audit`, `receipt`, `doctor`, `support-bundle`, `mcp`,
`config`
<!-- CLI-COMMANDS:END -->

<!-- SLASH-COMMANDS:START -->
`help`, `models`, `model`, `agent`, `agents`, `tier`, `audit`, `effort`, `doctor`, `clear`, `exit`, `mcp`, `autonomous-execution`, `subagent-driven-execution`, `self-review`, `recon`, `plan`, `research`, `project-review`, `code-review`, `writing-skills`, `writing-plans`, `queue`, `steer`, `btw`, `pin`, `drop`, `snapshot`, `limit`, `audit-receipt`, `rollback`, `logs-view`, `goal`, `goals`, `memory`, `workflow`, `workflow-templates`, `workflow-template`, `vault`, `vault-context`, `vault-search`, `vault-recent`, `vault-project`, `vault-tag`, `vault-tree`, `delegate`, `tree`, `broadcast`, `gather`, `scaffold`, `port`, `test-drive`, `bench`, `purge`, `stage-diff`, `review`, `ship`, `revert`, `photogen`, `frame`, `re-frame`, `videogen`, `sequence`, `animate`, `re-cut`, `output`, `storyboard`, `add`, `hud`
<!-- SLASH-COMMANDS:END -->


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
[Slash commands](#slash-commands)). Up-arrow recalls prompts across sessions
(history lives at `~/.aether-agent/history`); Tab completes slash commands.
`Ctrl-C` mid-answer cancels the turn and keeps the session; `Ctrl-C` at an
empty prompt (or `/exit`) leaves.

### `aether "<prompt>"` — one-shot
Runs a single turn against your default (or `--model`) and streams the answer.
`aether chat "<prompt>"` is the explicit form — it bypasses command matching,
so a prompt that happens to look like a command still chats.
```bash
aether "explain what src/router.ts does"
aether --model opus "rewrite this function to be O(n)"
```
A lone near-miss token is treated as a typo, not a prompt: `aether auht`
suggests `aether auth` and exits `2` instead of spending a turn on "auht".

### `aether code "<task>"` — autonomous coding agent
One host loop drives a pluggable brain: cloud (UVT-metered) by default,
`--local` for the built-in Ollama brain. The host renders every event, executes
every tool call locally, and verifies the result itself — the final status is
derived from your test command's exit code, never the brain's self-report.
Every run ends with a verdict line: `✓ ok · 4 files changed · tests green · 3m12s`.

| Flag | Meaning |
|---|---|
| `--local` | Use the built-in offline Ollama brain instead of the cloud. |
| `--resume <id\|file>` | Continue a prior session id, or a handoff file from another machine. |
| `--pool <gb>` | Context pool size in GB (status-bar reach = pool × 233M tokens). |
| `--effort <t>` | Effort tier: `LOW` \| `MED` \| `HIGH` \| `MAX` \| `ULTRA` \| `CODEPRO` (overrides the saved `/effort` dial). |
| `--test-cmd <c>` | Command the verification gate runs (unverified without it). |
| `--quiet` | Plain output (strip the personality frames). |
| `--interactive` | Pause at each stage boundary to type a steer (TTY only). |
| `--no-log` | Disable the local session log (`~/.aether-agent/logs`). |
| `--swarm <N>` | N-agent swarm (gated; local-only; refuses at runtime — see `commands/code.ts`). |

### `aether run <neo|kronus> "<task>"` — orchestrator
Hands a multi-step task to an orchestrator, which plans, fans out sub-agents,
and synthesizes. Streams task-level progress.
```bash
aether run neo "add pagination to the users endpoint and write tests"
aether run kronus "audit this service for race conditions and fix them"
```
> Orchestrators are gated to paid tiers. Neo is available on Solo+; Kronus on Pro+.

### `aether resume [id | export [id]]` — replay or carry a session
Replays a prior local coding session's transcript from `~/.aether-agent/logs/`.
With no id, uses the most recent session in this workspace.
```bash
aether resume                          # replay the latest session
aether resume <session-id>             # replay a specific one
aether resume export                   # write ./aether-handoff.json
aether resume export <id> --out h.json # …from a specific session, to a path
```
`export` writes a **handoff**: one portable JSON file carrying the task, the
model that ran it, the verify gate's verdict, the failing-test count, the files
the run changed, the verification command, and the repository identity (origin
remote, branch, HEAD). It carries no file contents, no shell commands, and no
absolute paths, so it can be copied to another checkout, machine, or OS.

Continue from either form:
```bash
aether agent --resume <session-id> "<what to do next>"   # same machine
aether agent --resume ./handoff.json                     # anywhere else
aether agent --resume ./handoff.json --model <other>     # …on another model
```
With no new task, the run continues the **original** task. Either way the prior
context is summarized into a continuation brief that the brain reads before its
instruction — you never re-paste the conversation. See
[`docs/demo/handoff.md`](docs/demo/handoff.md) for a runnable end-to-end proof.

> Local-first: sessions are read from disk, so resume works offline. When you stop
> a coding run with Ctrl-C, the exact `aether agent --resume <id>` command is printed.
> A session id is workspace-scoped; a handoff file deliberately is not.

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

### `aether doctor [--live | --fix]` — health, proof, and repair
Every check answers three questions separately, so "configured" is never
mistaken for "working":

```
Agent transport
  configured     yes
  reachable      yes
  verified now   yes · 15:42:08
```

A check nobody exercised reports `not checked` — never a pass. A surface this
build genuinely does not have reports `n/a` with the reason. Exits `1` if any
check is an error, so it is safe to gate scripts on.

**`aether doctor`** — fast and strictly read-only. No network call, no model
call, no session, no opener launch, no credential refresh, no write. Covers
runtime, workspace, git, transport config, auth config, tools, memory, MCP
registry, persistence, the media output index, the opener, GitHub, and
Protocol-C receipt storage.

**`aether doctor --live`** — proves the paths end to end, right now:
authenticated catalog fetch, a dev session, sequence-numbered frames,
pause/resume/steer acknowledgement, a sandboxed tool write/read/compare/delete
round trip, clean session close, a real browser open confirmed by a loopback
callback, GitHub identity, branch freshness compared **without fetching**, the
MCP broker, and a Protocol-C receipt round trip. Billing is accounted across
the run and reported as `spend.none`; the agent loop runs only when the server
confirms a non-billable doctor session, and is reported as unproven otherwise.
`--no-ui` skips the browser proof on a headless box (reported as skipped, not
passed).

**`aether doctor --fix`** — a closed allowlist of local repairs, never a repair
agent. Prints the exact scope, action, risk, reversibility and backup of every
planned repair and changes nothing without `--yes`. It will not rotate
credentials, spend UVT, invoke a model, edit source, mutate a git ref, dispatch
Actions, run Predator, or call an MCP write tool.

```bash
aether doctor                      # fast, read-only
aether doctor --live               # end-to-end proof, no spend
aether doctor --live --no-ui       # same, on a headless box
aether doctor --fix --dry-run      # show the repair plan, change nothing
aether doctor --fix --yes          # apply the plan
aether doctor --fix --only media.rebuild --yes
aether doctor --json               # schema-versioned report for automation
```

`--deep` still means the read-only report it always meant; it now points at
`--live` for the end-to-end proof.

### `aether skills <subcommand>` — inspect, trust, and manage agent skills

Skills are packaged instructions the agent can load. Built-in skills ship with
the package; user skills live under your config directory; project skills live
in the repository you are working in.

```bash
aether skills list                 # every discovered skill, with scope and trust
aether skills show <id>            # one skill: manifest, declared tools, digest
aether skills check [--all]        # validate manifests and report index errors
aether skills trust <id>           # approve a project skill at its current digest
aether skills lock                 # pin discovered project skills to a lockfile
```

**Project skills are untrusted until you approve them.** Trust is bound to the
skill's content digest, so editing a trusted skill revokes that trust until you
approve the new digest. A skill declaration narrows what the agent may do — it
never grants a tool the host would otherwise refuse.

### `aether capabilities [--available]` — what this build can actually do

Prints the capability contract: tools, their side-effect class, and the
permission each requires. `--available` additionally reports what is usable in
your current session rather than what exists in principle.

The command prefers the server manifest and falls back to a packaged snapshot
when the server cannot be reached. It says which one it used, and why, rather
than presenting stale data as live.

### `aether support-bundle` — a redacted diagnostic archive

Writes a `.tar` of metadata-only diagnostics for troubleshooting: a fast doctor
report, runtime facts, sanitized config, and skill and instruction inventories.

It carries counts, ids and digests — never prompts, file contents, tokens,
environment values or raw command text. Every entry is scanned before the
archive is finalized; if a secret is detected the bundle is refused rather than
written, and an interrupted run leaves no partial file behind.

Like `aether doctor`, it makes no network call and spends nothing.

### `aether mcp [list|doctor|repair]` — manage and diagnose MCP servers
With no subcommand (in a TTY), opens the same interactive MCP manager as the
`/mcp` slash command: an arrow-key menu over backend connections (OAuth/PAT
providers) and local custom servers (`mcp.json`), with authenticate / test /
disconnect actions per entry.

| Subcommand | Does |
|---|---|
| `aether mcp list` | Print a diagnostics report (providers, connections, tool counts). |
| `aether mcp doctor` | Same report; exits `1` if any check fails (scriptable health gate). |
| `aether mcp repair` | Back up and reset a corrupted local MCP registry (confirms first). |

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
| `defaultEffort` | string | Effort tier for `aether code` when `--effort` is omitted (`LOW`\|`MED`\|`HIGH`\|`MAX`\|`ULTRA`\|`CODEPRO`, `""` = server default). Same dial as `/effort`. |
| `permissionMode` | `ask`\|`auto`\|`skip` | Gate edits/commands: prompt every time, auto with confirm, or fully autonomous. |
| `autoApply` | bool | Apply streamed edits without a per-edit prompt. |
| `telemetry` | bool | Anonymous usage telemetry opt-in. |

---

## Slash commands (inside the REPL)

Type a prompt to chat; type `/` to drive the session. `/help` renders this same
set, grouped, inside the REPL. This table is the single source of truth — it
mirrors the live registry in `src/commands/slash_registry.ts`.

### Session

| Command | Action |
|---|---|
| `/help` | Show the grouped command menu. |
| `/models` | List chat models (numbered; `›` current, `🔒` locked). |
| `/model <n\|id>` | Switch model — opens the picker with no arg. Restarts the session. |
| `/agents` | View active agent sessions (name, status, time, UVT, task). |
| `/agent <n\|id>` | Switch orchestrator (Neo / Kronus) — opens the picker with no arg. |
| `/tier` | Show your plan tier, default, and available counts. |
| `/effort [tier\|1-6]` | Show or set the effort dial (`LOW`→`CODEPRO`). The dial moves phases, sub-agent fan-out, repair passes and the UVT ceiling; `CODEPRO` additionally enables System-2 review and unlimited context, and gets the banner. Persists to your Aether config and drives `aether code`. |
| `/audit [n]` | Recent chain-of-custody receipts. |
| `/doctor [deep]` | Run ordered diagnostics; `deep` adds bounded checks. |
| `/clear` | Clear the screen. |
| `/mcp [list|doctor|repair]` | Diagnose or confirmation-gated repair for MCP servers. |
| `/exit`, `/quit` | Leave the REPL. |

Typos get a nudge: `/modle` answers `did you mean /model?`. Tab completes any
of the above.

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
| `/rollback` | Discard uncommitted changes to tracked files (git-backed). Restores from the index, so files with staged changes come back to their staged state, not to the last commit. Untracked files are never touched. |
| `/logs-view`, `/logs` | Interactive session log browser. |

### Goals & workflows

| Command | Action |
|---|---|
| `/goal <desc>` | Create a goal; the agent plans phases. |
| `/goal view [id]` | Show the goal chain + detail. |
| `/goal start\|pause\|resume\|cancel\|complete\|note` | Drive a goal's lifecycle. |
| `/goals [id]` | List goals, or view one by id. |
| `/memory [status|inspect|forget|prune]` | Inspect/manage scoped memory tiers (`working`/`episodic`/`semantic`/`procedural`); `forget` and `prune --apply` are destructive. |
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

### UVT Tools

| Command | Action |
|---|---|
| `/scaffold <type> <name>` | Generate boilerplate: `component`, `route`, or `module`. |
| `/port <file\|dir> <lang>` | Translate code to another language. |
| `/test-drive "<target>"` | Generate a test matrix for a route/function, run it, and iterate until green (requires an active orchestrator). |
| `/bench <target>` | Profile a function/endpoint and suggest optimizations (requires an active orchestrator). |
| `/purge` | Flush pinned files, temp files, and the UVT cap back to a lean baseline. |
| `/stage-diff` | Unified diff of uncommitted changes + a suggested commit message. |
| `/revert <file\|step>` | Surgical rollback of a single file (git-backed). |

### Media

| Command | Action |
|---|---|
| `/photogen <prompt> [--model --aspect --count --4k --vector]` | Generate image(s). |
| `/frame <prompt>` | Generate a single styled frame. |
| `/re-frame <edit>` | Re-run the last image with an edit description. |
| `/videogen <prompt> [--model --duration --1080p --audio]` | Generate video. |
| `/sequence <prompt>` | Cinematic multi-shot video (routes to a cinematic model by default). |
| `/animate <image_url\|file\|#n> [motion]` | Animate a still image into video. |
| `/re-cut <edit>` | Re-edit the last generated video. |
| `/output [open <ref>\|clean]` | List, open, or clear recent generations. `<ref>` is a sequence number, a full artifact ID, or a unique ID prefix; an ambiguous reference lists its candidates instead of guessing. |
| `/storyboard <prompt\|file> [--scenes --style]` | Multi-scene storyboard: parse → preview → `--generate`/`--animate`/`--render`. |

### HUD

| Command | Action |
|---|---|
| `/add <element>`, `/add list` | Add a HUD overlay element (context-bar, timer, tools, help, health, status), or list what's available. |
| `/hud remove <element>` | Remove one active HUD element. |
| `/hud list`, `/hud` | List active HUD elements. |
| `/hud clear` | Remove all active HUD elements. |

---

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `AETHER_BASE_URL` | `https://api.aethersystems.net/cloud` | Overrides the config `baseUrl`. |
| `AETHER_LOGIN_URL` | `https://aethersystems.net/platform` | Page `aether auth login` opens. |
| `AETHER_TOKEN` | *(unset)* | Inject a session token (CI / headless / embedding). |
| `AETHER_CONFIG_DIR` | `~/.config/aether` | Config + token + REPL-history directory. |
| `AETHER_LOG_DIR` | `~/.aether-agent/logs` | Where session logs (and therefore `aether resume`) live. |
| `AETHER_BACKEND` | `auto` | `local` \| `cloud` \| `auto` — overrides the config `backend`. |
| `AETHER_LOCAL_BRAIN` | *(unset)* | `python` runs the separately-installed Unlimited-Context brain instead of the built-in Ollama one. |
| `OLLAMA_HOST` | `http://localhost:11434` | Where the offline brain looks for Ollama. Accepts Ollama's own scheme-less form (`127.0.0.1:11434`) as well as a full URL — see below. |
| `AETHER_STREAM_TIMEOUT_MS` | `120000` | Stream open/idle timeout (ms). `0` disables it. |
| `AETHER_NO_ANIM` | *(unset)* | `1` disables all animated status lines and the thinking pulse. |
| `NO_COLOR` | *(unset)* | Any value disables ANSI colors (https://no-color.org). |

See [`.env.example`](.env.example).

### `OLLAMA_HOST` accepted forms

`ollama serve` prints and binds a **scheme-less** `host:port`, and that is what most
people paste into `OLLAMA_HOST`. Every accepted form below is normalized to a full
base URL before any request is built:

| You set | Aether uses | Note |
|---|---|---|
| *(unset or empty)* | `http://localhost:11434` | The default. |
| `127.0.0.1:11434` | `http://127.0.0.1:11434` | Scheme-less — `http://` is added. |
| `localhost:11434` | `http://localhost:11434` | Scheme-less. |
| `0.0.0.0:11434` | `http://127.0.0.1:11434` | `0.0.0.0` is a *bind* address, not a *connect* address. |
| `http://localhost:11434/` | `http://localhost:11434` | Trailing slashes are stripped. |
| `https://ollama.example.com` | `https://ollama.example.com` | A remote/proxied Ollama. |

Anything that still will not parse as an `http`/`https` URL is rejected up front with
an error naming the bad value, instead of failing later as "cannot reach Ollama".

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
import { createClient } from "aether-agents";
const aether = createClient({ baseUrl, token });

aether.chatStream(prompt, { model?, agent?, manualModel? })  // AsyncIterable<StreamFrame>
aether.catalog()                                             // { models, tier, default }
aether.login(username, password, licenseKey?)
aether.http                                                  // raw authed HTTP on the same route
```

Stream frames: `open` · `ping` · `reasoning` · `delta` · `usage` · `done` ·
`error`, plus orchestrator frames `task_start` · `task_progress` · `task_done` ·
`task_failed` · `task_blocked` · `project_done`. Unknown frame types are ignored.
