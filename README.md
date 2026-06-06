<div align="center">

# ⌨️ Aether Code

A coding agent for your terminal** — every Aether model and orchestrator, in any repo, behind **one login**.

[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A520-14b8a6)](https://nodejs.org) [![Built by Aether](https://img.shields.io/badge/built%20by-Aether-7c3aed)](https://aethersystems.net)

**An open project from [Aether](https://aethersystems.net)** · Apache-2.0 · `npm i -g aether-code`

</div>

---

<div align="center">

> **Claude Code's ergonomics. Aether's brains. Your code never leaves the machine it's on.**
> One terminal that reaches *every* model and both orchestrators — sign in once with your Aether account, and the brain runs on Aether while your files stay local.

<p align="center">
  <a href="#the-problem">Problem</a> ·
  <a href="#the-fix">Fix</a> ·
  <a href="#how-it-works-60-seconds">How it works</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#sign-in">Sign in</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#embed-the-core">Embed</a> ·
  <a href="#security">Security</a>
</p>

</div>

---

## The problem

Every terminal coding agent ships welded to one vendor's model. You want Opus for the gnarly refactor, a cheap fast model for the boilerplate, a long-context model for the giant file, an **orchestrator** for the multi-step build — and you end up juggling four CLIs, four logins, four billing pages. Worse, most of them want your source pushed to *their* cloud just to think about it.

You shouldn't have to pick your model by picking your tool.

## The fix

Aether Code is **one terminal over the whole Aether model fleet.** Switch models mid-session like changing a setting. Reach the **Neo** and **Kronus** orchestrators when a task needs a planner + sub-agents, not just a chat. One account, one usage balance, one audit trail — and your repository stays on your disk. Aether Code is the *hands*; Aether runs the *brains*.

<p align="center"><strong>Four tools, four logins ✗ &nbsp;→&nbsp; One terminal, every model ✓</strong></p>

## How it works (60 seconds)

It's a thin, fast **client**. You stay local; only the prompt + the context you choose to send crosses the wire.

| Layer | Aether Code |
|---|---|
| **You** | type in the terminal — chat, code, or `/slash` commands |
| **The client** | builds the request, streams the answer token-by-token, applies edits to *your* files |
| **The Aether API** | runs the model or orchestrator you picked, meters usage, returns a signed audit receipt |

The model list, your plan tier, and what you're allowed to run all come from one place — `aether models` — so the terminal, the desktop app, and the web all show the **same** menu. Pick a model once; it's the same everywhere.

## What you get

- 🧠 **Every model + both orchestrators** — Claude (Haiku/Sonnet/Opus), GPT, DeepSeek, Kimi, Gemma, plus **Neo** and **Kronus** — from one `/models` menu, gated to your plan.
- ⚡ **Real streaming** — token-by-token output with a live usage meter, so you watch cost as it happens, not after.
- 💻 **Your code stays local** — edits are applied on your machine; only the prompt and the context you send leave. No repo upload.
- 🧾 **Auditable by default** — every turn gets a chain-of-custody receipt. `aether audit` lists them; `aether receipt <id>` exports the proof.
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
npm global install — no native deps, no daemon, no background service.

## Sign in

Aether Code requires an Aether account — it's the gate in front of the model fleet.

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

> No account yet? Create one at [aethersystems.net](https://aethersystems.net). The free tier gets you Haiku + a couple of fast models; paid tiers unlock Opus, the premium models, and the orchestrators.

## Commands

The handful you'll actually reach for — full reference in [`COMMANDS.md`](COMMANDS.md).

| Command | What it's for |
|---|---|
| `aether` | Open the interactive REPL — chat, code, and `/slash` commands. |
| `aether "<prompt>"` | One-shot: run a single turn and print the result. |
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
/models           list models           /agents          list orchestrators
/model <n|id>     switch model           /agent <n|id>    switch orchestrator
/tier             plan + default         /audit [n]       recent receipts
/clear            clear screen           /help            list commands
/exit, /quit      leave the REPL
```

## Quickstart

```bash
npm i -g aether-code        # or: npx aether-code
aether auth login          # authorize via aethersystems.net/platform
aether "refactor src/auth.ts to use async/await and add tests"
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

- **Your code stays local.** Aether Code applies edits on your machine. Only the prompt and the context you explicitly send ever leave — there's no background repo upload.
- **Tokens are credentials.** Stored `chmod 600` locally; never commit one. `.env` and `.aether-token` are git-ignored. `aether logout` clears it.
- **Path-guarded edits.** The client refuses to write outside your working directory.
- **The server is the authority.** Usage limits, model access, and signing are enforced by the Aether API — the client only displays what the server reports.

Found a vulnerability? See [`SECURITY.md`](SECURITY.md).

## Honest about what this is

Aether Code is a **client**, not a model. It needs an Aether account, and the models run on Aether's servers — that's the trade for getting the whole fleet behind one login without renting GPUs. If you want fully-local inference, [Unlimited Context](https://github.com/DBarr3/Unlimited-Context) (our other open project) is the one that runs on your own machine.

## ⭐ Star, share, contribute

If this made your terminal sharper, **drop a star** — it's how others find it. **PRs and issues welcome** — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

**Apache-2.0.** Use it, fork it, ship it. The license covers the code, not the Aether name or hosted service — see [NOTICE.md](NOTICE.md).

---

<div align="center">

Built by **Aether AI** · [aethersystems.net](https://aethersystems.net)

*One terminal. Every model. Your code stays yours.*

</div>
