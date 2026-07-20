<div align="center">

# Aether Agent

**A coding agent for your terminal — runs on hosted frontier models or fully offline on your own machine.**

[![CI](https://github.com/DBarr3/aether-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/DBarr3/aether-agent/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A524-14b8a6)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-7-3178c6)](https://www.typescriptlang.org/) [![Release notes](https://img.shields.io/badge/release-notes-7c3aed)](RELEASE_NOTES.md)

**Aether Agent is in beta.** Updates are shipping quickly.
```bash
npm i -g aether-agents     # or run once: npx aether-agents
```

[Install](#install-in-three-moves) · [Models & pricing](#models--pricing) · [Commands](#commands) · [Security](#security) · [Release notes](RELEASE_NOTES.md)

<a href="https://app.aethersystems.net/">
<img width="760" alt="Aether Agent — terminal coding session" src="https://github.com/user-attachments/assets/f7a71cbb-6be2-41ea-b2a4-35c7c0d889d6" />
</a>

</div>

It scans, plans, edits, and runs your tests — in your repo, on your terms. Verification is ground truth: the agent re-runs your test command and reads the exit code itself, so "done" is never the model's word. And with **QOPC memory** it learns from what you accept, revise, or discard — measurably better the more you use it, no config, no fine-tuning.

## Install in three moves

<div align="center">

<img width="800" alt="Install in three moves — drop it in, run on the fleet, or go fully offline" src="https://github.com/user-attachments/assets/fabfd1ac-ca6a-43a4-86cd-c63bb80317b0" />

</div>

```bash
npm i -g aether-agents     # 01 — drop it in (Node ≥ 24)

aether auth login          # 02 — sign in once
aether agent               #      …terminal opens. Just start chatting.

ollama pull qwen2.5-coder:7b   # 03 — or go offline: no account, no network
aether agent --local           #      …same terminal, nothing leaves the machine
```

`aether agent` opens the REPL — chat with the model, slash-commands at hand, the agent edits files and runs your tests **in the same session**. Both brains run through the same host loop, render, tools, and commands — switching just swaps the transport. On the hosted path your code stays local and only the prompt + context you send leaves; on `--local`, nothing leaves at all. The local brain runs on **[Unlimited Context](https://github.com/DBarr3/Unlimited-Context-LLM)** — Aether's open-source (Apache-2.0) memory engine that gives any Ollama model a billion-token working memory.

> Prefer a script? `curl -fsSL https://aethersystems.net/install.sh | sh` (macOS / Linux / WSL) · `irm https://aethersystems.net/install.ps1 | iex` (Windows PowerShell). Both just verify Node and run the npm install — no native deps, no daemon.

## Models & pricing

<div align="center">

<a href="https://aethersystems.net/">
<img width="800" alt="Model fleet with open per-token pricing — text and coding models, image and video generation, orchestrators" src="https://github.com/user-attachments/assets/63662c5f-2b05-4935-ac14-6a131767c8f5" />
</a>

</div>

One fleet, transparent per-token pricing — Claude, GPT, DeepSeek, Kimi, and Gemma for text & code, image and video generation, plus the **Neo · Kronus · Aether-Vision** orchestrators. On `--local`, any Ollama model you've pulled. Run `aether models` to list everything from the terminal.

Usage is metered in **UVT** — one universal credit, one balance, shared across this agent, the [AetherCloud desktop](https://github.com/DBarr3/aethercloud), and Aether AI on the web. Free tier to try (no card), subscription for premium models, UVT top-ups for pay-as-you-go. **Current tiers and prices: [aethersystems.net](https://aethersystems.net/)**

## Commands

<div align="center">

<a href="COMMANDS.md">
<img width="800" alt="Slash commands — session, agent modes, steering, context and limits, goals and workflows, vault, orchestra" src="https://github.com/user-attachments/assets/52ca6de0-0958-4237-9dfd-776c9e55822d" />
</a>

</div>

Inside the REPL, `/` commands control the whole session — type `/help` to see them in-session, or click the card above for the full reference. That includes generating images and video from the prompt line (`/photogen`, `/videogen`, `/storyboard` …) and connecting **MCP servers** with `/mcp`. From the shell:

```bash
aether agent                      # the main thing — open the REPL and chat
aether agent --local              # same REPL on a local Ollama brain (offline)
aether models                     # list models + orchestrators
aether resume                     # replay / continue the last session
```

Flags you can set when launching the REPL (or pass with an inline task `aether agent "<task>"` for one-shot autonomous mode):

| Flag | What it does |
|---|---|
| `--local` | Local Ollama brain instead of the hosted API. |
| `--model <id>` | Force a model (`--model opus`, or an Ollama tag with `--local`). |
| `--effort <tier>` | Budget ceiling: `LOW` · `MED` · `MAX` · `ULTRA` · `CODEPRO`. |
| `--test-cmd <cmd>` | Command the verification gate runs (default `pytest -q`). |
| `--worktree` | Fresh git worktree on an auto-named branch (isolated). |
| `--repo <owner/name>` | Clone a GitHub repo via your own `gh`/`git` auth, work it in a worktree. |
| `-y`, `--yes` | Auto-confirm prompts (non-interactive). |

**Full reference** — every command, flag, slash command, and env var: [COMMANDS.md](COMMANDS.md). Dated patch notes: [RELEASE_NOTES.md](RELEASE_NOTES.md) · [docs/releases/](docs/releases/).

## Development

The application and executable test suite are fully on **TypeScript 7.0.2**, with **Node.js 24 or newer** as the supported runtime. Strict ESM compilation emits the distributable JavaScript to `dist/`; the published package contains `dist/src` and excludes compiled tests.

Run the release gates from a clean checkout:

```bash
npm ci
npm run typecheck
npm test
npm run smoke
npm pack --dry-run
```

The verified TypeScript 7 release baseline is tagged [`v0.1.0`](https://github.com/DBarr3/aether-agent/tree/v0.1.0). Migration details and measurements are in the [TypeScript 7 upgrade design](docs/specs/2026-07-20-typescript-7-terminal-upgrade-design.md).

## Security

- **Your code stays local.** Edits apply on your machine, path-guarded — the client refuses to write outside your working directory.
- **Verification is ground truth.** The host runs your test command and reads the exit code itself; "done" is never the model's word.
- **Tokens are credentials.** Stored `chmod 600`, never committed; `aether auth logout` clears them.
- **The server is the authority.** On the API path, usage limits, model access, and signed chain-of-custody receipts are enforced server-side — the client only displays what the server reports.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Part of the Aether platform

Aether Agent is the **terminal sibling** of **[AetherCloud](https://github.com/DBarr3/aethercloud)**, the agentic desktop app — same login, same UVT balance, same model fleet. Drive your repo from the command line; drive projects, workflows, and the memory Vault from the desktop. Get the desktop at **[aethersystems.net/download](https://aethersystems.net/)** — installs in about a minute, no card needed.

## License

Apache-2.0 — use it, fork it, ship it. The license covers the code, not the Aether name or hosted service ([LICENSE](LICENSE) · [NOTICE.md](NOTICE.md)). PRs and issues welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

Built by **Aether AI** · [aethersystems.net](https://aethersystems.net)

*One terminal. Frontier models or fully local. Your code stays yours.*

</div>
