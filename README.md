<div align="center">

# ⌨️ Aether Code

An **open-source coding agent for your terminal** — every Aether model in the cloud, **or fully local on your own machine**, behind one workflow.

[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A520-14b8a6)](https://nodejs.org) [![Built by Aether](https://img.shields.io/badge/built%20by-Aether-7c3aed)](https://aethersystems.net)

**An open project from [Aether](https://aethersystems.net)** · Apache-2.0 · `npm i -g aether-code`

</div>

---

<div align="center">

> **Claude Code's ergonomics. Aether's brains — cloud or local. Your code never leaves the machine it's on.**
> One terminal, two brains: sign in to reach *every* Aether model and both orchestrators, or run `aether code --local` and the whole loop happens on your hardware. Same host, same commands, your files always stay put.

<p align="center">
  <a href="#the-problem">Problem</a> ·
  <a href="#the-fix">Fix</a> ·
  <a href="#two-brains-one-terminal">Two brains</a> ·
  <a href="#how-it-works-60-seconds">How it works</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#embed-the-core">Embed</a> ·
  <a href="#security">Security</a>
</p>

</div>

![Aether Code terminal](assets/aether_code_console.png)

---

## The problem

Every terminal coding agent ships welded to one vendor's model. You want Opus for the gnarly refactor, a cheap fast model for the boilerplate, a long-context model for the giant file, an **orchestrator** for the multi-step build — and you end up juggling four CLIs, four logins, four billing pages. Worse, most of them want your source pushed to *their* cloud just to think about it — and none of them will run on the box on your desk when you're offline or air-gapped.

You shouldn't have to pick your model by picking your tool. And you shouldn't have to choose between "powerful" and "stays on my machine."

## The fix

Aether Code is **one terminal with two interchangeable brains.** Sign in and reach the **whole Aether model fleet** — switch models mid-session like changing a setting, and call the **Neo** and **Kronus** orchestrators when a task needs a planner + sub-agents. Or flip on `--local` and the exact same terminal runs entirely on your hardware: a local Python brain on the **[Unlimited Context](https://github.com/DBarr3/Unlimited-Context)** engine, doing inference through **Ollama**. Either way, your repository stays on your disk — Aether Code is the *hands*; the brain is yours to place.

<p align="center"><strong>Four tools, four logins ✗ &nbsp;→&nbsp; One terminal, cloud or local ✓</strong></p>

## Two brains, one terminal

The host loop is the seam. The **brain decides** (it emits events); the **host renders** every event and **executes every tool call locally**, then replies. Because that contract is identical on both paths, cloud and local are indistinguishable in use — same render, same commands, same tools.

| | **Cloud** (default) | **Local** (`--local`) |
|---|---|---|
| **Brain runs on** | the Aether API | your machine (Python + Ollama) |
| **Models** | Claude, GPT, DeepSeek, Kimi, Gemma + **Neo**/**Kronus** | your Ollama models, via the Unlimited Context engine |
| **Login** | your Aether account (one balance, one bill) | none — fully offline-capable |
| **Your code** | stays local; only the prompt + chosen context leaves | never leaves the machine at all |
| **Metering** | UVT usage meter + audit receipts | none — it's your hardware |

```bash
aether code "refactor src/auth.ts to async/await"          # cloud brain
aether code --local "refactor src/auth.ts to async/await"  # local Python/Ollama brain
```

## How it works (60 seconds)

It's a thin, fast **client** either way. You stay local; on the cloud path only the prompt + the context you choose to send crosses the wire, and on the local path nothing crosses it at all.

| Layer | Aether Code |
|---|---|
| **You** | type in the terminal — chat, code, or `/slash` commands |
| **The host** | builds the request, renders the stream token-by-token, applies edits to *your* files, runs the tools |
| **The brain** | **cloud:** the Aether API runs the model/orchestrator you picked, meters usage, returns a signed receipt · **local:** the Unlimited Context engine + Ollama decide, on your box |

The model list, your plan tier, and what you're allowed to run all come from one place — `aether models` — so the terminal, the desktop app, and the web all show the **same** menu. Pick a model once; it's the same everywhere.

## What you get

- 🧠 **Every model + both orchestrators** — Claude (Haiku/Sonnet/Opus), GPT, DeepSeek, Kimi, Gemma, plus **Neo** and **Kronus** — from one `/models` menu, gated to your plan.
- 🏠 **Or no cloud at all** — `--local` runs the whole loop on your machine through the Unlimited Context engine + Ollama. Offline, air-gap, and privacy-first by construction.
- ⚡ **Real streaming** — token-by-token output with a live context/usage meter, so you watch the pool fill as it happens.
- 💻 **Your code stays local** — edits are applied on your machine; on the cloud path only the prompt and the context you send leave. No repo upload, ever.
- 🧾 **Auditable by default** — every cloud turn gets a chain-of-custody receipt. `aether audit` lists them; `aether receipt <id>` exports the proof.
- 🔑 **One login** — `aether login` authorizes through your Aether account. One balance, one bill, managed at [aethersystems.net](https://aethersystems.net).
- 🧩 **Embeddable core** — the same client that powers this CLI is a library (`createClient`), so the desktop app and the web chat route through the *exact* same path.
- 🪶 **Light + boring to install** — a single Node binary, `npm i -g aether-code`, no native deps.

## Install

```bash
# npm — any platform
npm install -g aether-code

# macOS / Linux / WSL
curl -fsSL https://aethersystems.net/install.sh | sh

# Windows — PowerShell
irm https://aethersystems.net/install.ps1 | iex

# run without installing
npx aether-code
```

Aether Code needs **Node.js ≥ 20**. The installers just verify Node and run the
npm global install — no native deps, no daemon, no background service. For the
local brain you'll also want **Python** and **[Ollama](https://ollama.com)** on
your `PATH` (see [Go local](#go-local)).

## Sign in (cloud)

The cloud path needs an Aether account — it's the gate in front of the model fleet.

```bash
aether auth login
# → opens aethersystems.net/platform in your browser
# → sign in, create a CLI token, paste it back into the terminal
```

The token is stored locally (`~/.config/aether/`, `chmod 600`) and sent as a Bearer
credential on every request. Manage your plan, usage, and tokens at
**[aethersystems.net/platform](https://aethersystems.net/platform)**.

```bash
aether auth status     # who you are, which token, what tier
aether auth token      # print the token (for scripts / CI)
aether auth refresh    # refresh a session token
aether auth logout     # sign out
```

Headless / CI: `aether auth login --with-token < token.txt`,
`aether auth login --token <t>`, or set `AETHER_TOKEN`.

> No account yet? Create one at [aethersystems.net](https://aethersystems.net). The free tier gets you Haiku + a couple of fast models; paid tiers unlock Opus, the premium models, and the orchestrators. **Or skip the account entirely and run `--local`.**

## Go local

`aether code --local` swaps the cloud brain for a headless Python brain on the
**[Unlimited Context](https://github.com/DBarr3/Unlimited-Context)** engine, doing
inference through **Ollama** — no account, no network, no metering. The host loop,
the render, the tools, and the commands are identical to the cloud path; only the
brain transport changes.

```bash
# one-time: have Python + Ollama on PATH, and pull a model
ollama pull qwen2.5-coder:7b      # or gemma3:4b · qwen3-coder:30b for depth

aether code --local "add a retry with backoff to the fetch helper"
```

Pick the local model with `--model` (e.g. `--model gemma3:4b`); point at a specific
interpreter or Ollama host with `AETHER_PYTHON` and `OLLAMA_HOST`. The context pool
(the status-bar denominator) defaults to 5 GB ≈ 1.17B tokens — size it with
`--pool <GB>`.

## Commands

The handful you'll actually reach for — full reference in [`COMMANDS.md`](COMMANDS.md).

| Command | What it's for |
|---|---|
| `aether` | Open the interactive REPL — chat, code, and `/slash` commands. |
| `aether "<prompt>"` | One-shot: run a single turn and print the result. |
| `aether code "<task>"` | Autonomous coding agent — cloud brain, UVT-metered. |
| `aether code --local "<task>"` | Same agent, fully local (Python/Ollama, offline). |
| `aether run neo "<task>"` | Hand a multi-step task to an orchestrator (Neo / Kronus). |
| `aether models` | List every model + orchestrator you can use (🔒 = locked on your tier). |
| `aether models use <id>` | Set your default model. |
| `aether auth login` / `logout` | Authorize via aethersystems.net/platform / sign out. |
| `aether auth status` / `token` | Show login state / print the token for scripts. |
| `aether audit [n]` | Recent chain-of-custody receipts for your account. |
| `aether receipt <id>` | Export the cryptographic proof package for one entry. |
| `aether config` | Show or edit local settings (default model, permission mode). |

**Inside the REPL**, Claude-Code-style slash commands:

```text
/models            list models            /agents         list orchestrators
/model <n|id>      switch model           /agent <n|id>   switch orchestrator
/tier              plan + default         /audit [n]      recent receipts
/clear             clear screen           /help           list commands
/exit, /quit       leave the REPL
```

## Quickstart

```bash
npm i -g aether-code        # or: npx aether-code
aether auth login          # cloud: authorize via aethersystems.net/platform
aether code "refactor src/auth.ts to use async/await and add tests"

# …or skip the login and stay on your machine:
aether code --local "refactor src/auth.ts to use async/await and add tests"
```

Or drop into a session and switch models on the fly:

```text
$ aether
Aether Code — an open-source coding agent for your terminal.
Type a prompt, or /help for commands. /exit to quit.

aether› /models
tier: pro
›  1. sonnet     Claude Sonnet 4.6
   2. opus       Claude Opus 4.7        cap 60000
   3. gpt55      GPT-5.5
   ...
aether› /model opus
model → Claude Opus 4.7
aether› find the race condition in the order executor and fix it
```

## Embed the core

The CLI is just a terminal frontend over a small, typed client. Import it and route any surface — a desktop app, a web chat, your own tool — through the **same** universal path:

```ts
import { createClient } from "aether-code";

const aether = createClient({ token: process.env.AETHER_TOKEN });

for await (const frame of aether.chatStream("Summarize this diff", { model: "sonnet" })) {
  if (frame.type === "delta") process.stdout.write(frame.text);
}

const { models } = await aether.catalog();   // same /models menu, one source
```

`AETHER_BASE_URL` and `AETHER_TOKEN` let a host inject its own session — that's how one core powers the terminal, the desktop, and the web without three different chat implementations.

## Security

- **Your code stays local.** Aether Code applies edits on your machine. On the cloud path only the prompt and the context you explicitly send ever leave — there's no background repo upload. On `--local`, nothing leaves at all.
- **Tokens are credentials.** Stored `chmod 600` locally; never commit one. `.env` and `.aether-token` are git-ignored. `aether logout` clears it.
- **Path-guarded edits.** The client refuses to write outside your working directory.
- **The server is the authority.** On the cloud path, usage limits, model access, and signing are enforced by the Aether API — the client only displays what the server reports.

Found a vulnerability? See [`SECURITY.md`](SECURITY.md).

## Honest about what this is

Aether Code is a **client**, not a model. On the cloud path it needs an Aether account and the models run on Aether's servers — that's the trade for getting the whole fleet behind one login without renting GPUs. On `--local` it runs the **[Unlimited Context](https://github.com/DBarr3/Unlimited-Context)** engine + Ollama on your own machine, so you trade the fleet for full privacy and offline use. Same terminal; you pick the trade per run.

## ⭐ Star, share, contribute

If this made your terminal sharper, **drop a star** — it's how others find it. **PRs and issues welcome** — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

**Apache-2.0.** Use it, fork it, ship it. The license covers the code, not the Aether name or hosted service — see [NOTICE.md](NOTICE.md).

---

<div align="center">

Built by **Aether AI** · [aethersystems.net](https://aethersystems.net)

*One terminal. Every model — cloud or local. Your code stays yours.*

</div>
