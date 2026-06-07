<div align="center">

# Aether Code

**A simple agentic coding terminal for Aether's API and local models.**

[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A520-14b8a6)](https://nodejs.org) [![Built by Aether](https://img.shields.io/badge/built%20by-Aether-7c3aed)](https://aethersystems.net)

`npm i -g aether-code`

</div>

![Aether Code — coding session](assets/aether_code_console.png)

---

## What it is

Aether Code is a coding agent that lives in your terminal. It reads your code, plans, edits files, runs your tests, and fixes what broke — then shows its work as it goes.

It runs on **two interchangeable brains**:

- **API** (default) — sign in and use Aether's hosted models: Claude, GPT, DeepSeek, Kimi, Gemma, plus the **Neo** and **Kronus** orchestrators. Switch between them mid-session.
- **Local** (`--local`) — the exact same terminal, running entirely on your machine through **Ollama**. No account, no network.

Either way it's a thin client: edits apply to *your* files on *your* disk, and your repository is never uploaded.

**Three ways to run it:**

```bash
aether                          # interactive REPL — chat + /slash commands
aether "explain src/router.ts"  # one-shot answer, then exit
aether code "fix the failing tests"   # autonomous agent: edits files + verifies
```

## API vs local

| | **API** (default) | **Local** (`--local`) |
|---|---|---|
| Models run on | the Aether API | your machine, via Ollama |
| Models | full Aether fleet + Neo / Kronus | any Ollama model you've pulled |
| Login | your Aether account | none — fully offline |
| Your code | stays local; only the prompt + context you send leaves | never leaves the machine |
| Metering | UVT usage meter + signed receipts | none — it's your hardware |

```bash
aether code "refactor src/auth.ts to async/await"          # API brain
aether code --local "refactor src/auth.ts to async/await"  # local brain
```

## Quickstart

```bash
npm i -g aether-code          # needs Node >= 20   (or run once with: npx aether-code)
aether auth login             # API path: authorize via aethersystems.net
aether code "refactor src/auth.ts to async/await and add tests"

# …or skip the login and run entirely on your own machine:
aether code --local "same task, offline"
```

No account? Create one free at [aethersystems.net](https://aethersystems.net) — the free tier covers Haiku and a few fast models; paid tiers unlock Opus, the premium models, and the orchestrators. Or skip it and run `--local`.

**Other installs:** `curl -fsSL https://aethersystems.net/install.sh | sh` (macOS / Linux / WSL) · `irm https://aethersystems.net/install.ps1 | iex` (Windows PowerShell). The installers just verify Node and run the npm global install — no native deps, no daemon.

## How a run works

`aether code` is a host loop wrapped around a brain. The **brain decides** (it emits events: scan, plan, edit, verify); the **host renders** each event, **executes every tool call locally**, and replies. Because that contract is identical on both paths, the API and local brains behave the same way.

The verification gate is the honest part: when the run finishes, **the host runs your test command itself and derives pass/fail from the exit code** — it never trusts the model's "done." A green result means your tests actually passed. Set the command with `--test-cmd` (default `pytest -q`).

## Running the agent — `aether code`

```bash
aether code [flags] "<task>"
```

| Flag | What it does |
|---|---|
| `--local` | Use the local Python/Ollama brain instead of the API. |
| `--model <id>` | Force a model for this run (e.g. `--model opus`, or an Ollama tag with `--local`). |
| `--pool <gb>` | Context pool size in GB. The status-bar reach is `pool × 233M` tokens (default 5 GB ≈ 1.17B). |
| `--effort <tier>` | Budget ceiling: `LOW` · `MED` · `MAX` · `ULTRA` · `CODEPRO`. |
| `--test-cmd <cmd>` | Command the verification gate runs (default `pytest -q`). |
| `--interactive` | Pause at each stage boundary so you can type a steer (TTY only). |
| `--quiet` | Plain output — strip the animated status frames. |
| `--json` | Emit raw stream frames as JSON lines (machine mode). |
| `--no-log` | Disable the local session log (`~/.aether-code/logs`). |
| `-y`, `--yes` | Auto-confirm prompts (non-interactive). |

```bash
aether code --model opus --effort MAX "find the race condition in the order executor and fix it"
aether code --test-cmd "npm test" "make the auth tests pass"
aether code --local --model qwen2.5-coder:7b "add a retry with backoff to the fetch helper"
```

## The REPL and slash commands

Run `aether` with no arguments to open an interactive session. Type a prompt to chat; type `/` commands to control it. `Ctrl-C` or `/exit` leaves.

```text
$ aether
aether› /model opus
model → Claude Opus 4.7
aether› find the race condition in the order executor and fix it
```

| Slash command | Action |
|---|---|
| `/models` | List chat models (numbered; `›` current, `🔒` locked). |
| `/model <n\|id>` | Switch model by list number or id. |
| `/agents` · `/agent <n\|id>` | List / switch orchestrators (Neo, Kronus). |
| `/tier` | Show your plan tier, default, and available counts. |
| `/audit [n]` | Recent chain-of-custody receipts. |
| `/doctor` | Diagnose your setup (API reachability, auth, tier). |
| `/clear` | Clear the screen. |
| `/help` | List slash commands. |
| `/exit`, `/quit` | Leave the REPL. |

## Models and orchestrators

```bash
aether models                 # every model + orchestrator on your tier
aether models use sonnet      # set your default model
aether run neo "add pagination to the users endpoint and write tests"
aether run kronus "audit this service for race conditions and fix them"
```

In the list, `*` marks your default, `🔒` marks a model locked on your plan, and `cap N` is the monthly UVT ceiling. Orchestrators are gated: **Neo** on Solo+, **Kronus** on Pro+.

## Go local

`--local` swaps the API for a headless Python brain on the [Unlimited Context](https://github.com/DBarr3/Unlimited-Context) engine (`python -m aether_agent.headless`), doing inference through **Ollama** — no account, no network. The host loop, render, tools, and commands are identical to the API path.

```bash
# one-time: have Python + Ollama on PATH, then pull a model
ollama pull qwen2.5-coder:7b
aether code --local "add a retry with backoff to the fetch helper"
```

| Local model | Size | Notes |
|---|---|---|
| `qwen2.5-coder:7b` | ~4.7 GB | Universal default — fits an 8 GB GPU, best small-model tool use. |
| `gemma3:4b` | ~3.3 GB | Lighter option (`gemma3n:e4b` for the efficient variant). |
| `qwen3-coder:30b` | ~24 GB | For depth — needs ~24 GB RAM/VRAM. |

Pick the model with `--model <tag>`, point at a specific interpreter or Ollama host with `AETHER_PYTHON` / `OLLAMA_HOST`, and size the context pool with `--pool <GB>`.

## Sign in (API path)

The API path authorizes through your Aether account — one credential for the CLI, desktop, and web.

```bash
aether auth login      # opens aethersystems.net/platform; paste the CLI token
aether auth status     # who you are, token type, base URL, tier
aether auth token      # print the token (for scripts / CI)
aether auth refresh    # refresh a session token (API tokens don't expire)
aether auth logout     # sign out and clear the stored credential
```

The token is stored locally (`~/.config/aether/`, `chmod 600`) and sent as a Bearer credential on every request. Headless / CI: `aether auth login --with-token < token.txt`, `--token <t>`, or set `AETHER_TOKEN`.

## Config

Local settings live at `~/.config/aether/config.json`.

```bash
aether config                          # show all
aether config set defaultModel opus
aether config set permissionMode ask   # ask | auto | skip
aether config set autoApply true
```

| Key | Meaning |
|---|---|
| `defaultModel` | Model used when `--model` is omitted. |
| `permissionMode` | Gate edits/commands: `ask` (prompt), `auto` (apply with confirm), `skip` (autonomous). |
| `autoApply` | Apply streamed edits without a per-edit prompt. |
| `baseUrl` | Aether API base URL. |
| `telemetry` | Anonymous usage telemetry opt-in. |

## Audit and receipts (API path)

Every API turn gets a chain-of-custody receipt.

```bash
aether audit 20                 # recent receipts: timestamp · event · hash · order_id
aether receipt chat_8f3a...     # export the cryptographic proof package for one entry
```

## Embed the core

The CLI is a terminal frontend over a small, typed client. Import it and route any surface — desktop app, web chat, your own tool — through the same path.

```ts
import { createClient } from "aether-code";

const aether = createClient({ token: process.env.AETHER_TOKEN });

for await (const frame of aether.chatStream("Summarize this diff", { model: "sonnet" })) {
  if (frame.type === "delta") process.stdout.write(frame.text);
}

const { models } = await aether.catalog();   // same /models menu, one source
```

`createClient` also exposes `catalog()`, `login()`, and `.http` (raw authed HTTP on the same route). Stream frames: `open` · `reasoning` · `delta` · `usage` · `done` · `error`, plus orchestrator frames (`task_start`, `task_progress`, `task_done`, …). Unknown frames are ignored.

## Security

- **Your code stays local.** Edits apply on your machine, path-guarded — the client refuses to write outside your working directory. On the API path only the prompt and the context you send leave; on `--local`, nothing leaves at all.
- **Verification is ground truth.** The host runs your test command and reads the exit code itself; "done" is never the model's word.
- **Tokens are credentials.** Stored `chmod 600`, never committed; `aether auth logout` clears them.
- **The server is the authority.** On the API path, usage limits, model access, and signing are enforced by the Aether API — the client only displays what the server reports.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Reference

| Env var | Default | Meaning |
|---|---|---|
| `AETHER_BASE_URL` | `https://api.aethersystems.net` | Override the API base URL. |
| `AETHER_TOKEN` | *(unset)* | Inject a token (CI / headless / embedding). |
| `AETHER_PYTHON` | `python` | Interpreter for the local brain. |
| `OLLAMA_HOST` | *(Ollama default)* | Ollama host for the local brain. |
| `AETHER_CONFIG_DIR` | `~/.config/aether` | Config + token directory. |

Exit codes: `0` success · `1` runtime error · `2` usage error. Full flag, command, and env reference in [COMMANDS.md](COMMANDS.md).

## License

Apache-2.0 — use it, fork it, ship it. The license covers the code, not the Aether name or hosted service ([LICENSE](LICENSE) · [NOTICE.md](NOTICE.md)). PRs and issues welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

Built by **Aether AI** · [aethersystems.net](https://aethersystems.net)

*One terminal. Aether's models — API or local. Your code stays yours.*

</div>
