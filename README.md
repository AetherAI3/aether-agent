<div align="center">

# Aether Agent

**An open-source coding agent for your terminal — runs on hosted frontier models or fully offline on your own machine.**

[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A520-14b8a6)](https://nodejs.org) [![Release notes](https://img.shields.io/badge/release_notes-june_2026-7c3aed)](RELEASE_NOTES.md)

```bash
npm i -g aether-agent     # or run once: npx aether-agent
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
npm i -g aether-agent                            # 01 — drop it in (Node ≥ 20)

aether auth login                                # 02 — hosted: sign in once…
aether agent "refactor src/auth.ts to async"     #      …and run on the fleet

ollama pull qwen2.5-coder:7b                     # 03 — local: no account, no network
aether agent --local "same task, offline"        #      nothing leaves the machine
```

Both brains run through the **same** host loop, render, tools, and commands — switching just swaps the transport. On the hosted path your code stays local and only the prompt + context you send leaves; on `--local`, nothing leaves at all.

> Prefer a script? `curl -fsSL https://aethersystems.net/install.sh | sh` (macOS / Linux / WSL) · `irm https://aethersystems.net/install.ps1 | iex` (Windows PowerShell). Both just verify Node and run the npm install — no native deps, no daemon.

## Models & pricing

<div align="center">

<a href="https://aethersystems.net/pricing">
<img width="800" alt="Model fleet with open per-token pricing — text and coding models, image and video generation, orchestrators" src="https://github.com/user-attachments/assets/63662c5f-2b05-4935-ac14-6a131767c8f5" />
</a>

</div>

One fleet, transparent per-token pricing — Claude, GPT, DeepSeek, Kimi, and Gemma for text & code, image and video generation, plus the **Neo · Kronus · Aether-Vision** orchestrators. On `--local`, any Ollama model you've pulled. Run `aether models` to list everything from the terminal.

Usage is metered in **UVT** — one universal credit, one balance, shared across this agent, the [AetherCloud desktop](https://github.com/DBarr3/aethercloud), and Aether AI on the web. Free tier to try (no card), subscription for premium models, UVT top-ups for pay-as-you-go. **Current tiers and prices: [aethersystems.net/pricing](https://aethersystems.net/pricing)**

## Commands

<div align="center">

<a href="COMMANDS.md">
<img width="800" alt="Slash commands — session, agent modes, steering, context and limits, goals and workflows, vault, orchestra" src="https://github.com/user-attachments/assets/52ca6de0-0958-4237-9dfd-776c9e55822d" />
</a>

</div>

Inside the REPL, `/` commands control the whole session — type `/help` to see them in-session, or click the card above for the full reference. From the shell:

```bash
aether                            # interactive REPL — chat + /slash commands
aether "explain src/router.ts"    # one-shot answer, then exit
aether agent [flags] "<task>"     # autonomous agent: edits files + verifies
aether models                     # list models + orchestrators
aether resume                     # replay / continue the last session (offline)
```

| `aether agent` flag | What it does |
|---|---|
| `--local` | Local Ollama brain instead of the hosted API. |
| `--model <id>` | Force a model (`--model opus`, or an Ollama tag with `--local`). |
| `--effort <tier>` | Budget ceiling: `LOW` · `MED` · `MAX` · `ULTRA` · `CODEPRO`. |
| `--test-cmd <cmd>` | Command the verification gate runs (default `pytest -q`). |
| `--worktree` | Fresh git worktree on an auto-named branch (isolated). |
| `--repo <owner/name>` | Clone a GitHub repo via your own `gh`/`git` auth, work it in a worktree. |
| `--interactive` | Pause at each stage boundary to type a steer (TTY only). |
| `-y`, `--yes` | Auto-confirm prompts (non-interactive). |

**Full reference** — every command, flag, slash command, and env var: [COMMANDS.md](COMMANDS.md). Dated patch notes: [RELEASE_NOTES.md](RELEASE_NOTES.md) · [docs/releases/](docs/releases/).

## Security

- **Your code stays local.** Edits apply on your machine, path-guarded — the client refuses to write outside your working directory.
- **Verification is ground truth.** The host runs your test command and reads the exit code itself; "done" is never the model's word.
- **Tokens are credentials.** Stored `chmod 600`, never committed; `aether auth logout` clears them.
- **The server is the authority.** On the API path, usage limits, model access, and signed chain-of-custody receipts are enforced server-side — the client only displays what the server reports.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Part of the Aether platform

Aether Agent is the **terminal sibling** of **[AetherCloud](https://github.com/DBarr3/aethercloud)**, the agentic desktop app — same login, same UVT balance, same model fleet. Drive your repo from the command line; drive projects, workflows, and the memory Vault from the desktop. Get the desktop at **[aethersystems.net/download](https://aethersystems.net/download)** — installs in about a minute, no card needed.

## License

Apache-2.0 — use it, fork it, ship it. The license covers the code, not the Aether name or hosted service ([LICENSE](LICENSE) · [NOTICE.md](NOTICE.md)). PRs and issues welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

Built by **Aether AI** · [aethersystems.net](https://aethersystems.net)

*One terminal. Frontier models or fully local. Your code stays yours.*

</div>
