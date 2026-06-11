<div align="center">

# Aether Agent

**An open-source coding agent for your terminal — runs on hosted frontier models or fully offline on your own machine.**

[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A520-14b8a6)](https://nodejs.org) [![Built by Aether](https://img.shields.io/badge/built%20by-Aether-7c3aed)](https://aethersystems.net)

```bash
npm i -g aether-agent     # or run once: npx aether-agent
```
</div>

<div align="center">

<a href="https://app.aethersystems.net/">
<img width="720" alt="Aether Agent — terminal coding session" src="https://github.com/user-attachments/assets/f7a71cbb-6be2-41ea-b2a4-35c7c0d889d6" />
</a>

<br><br>

<table>
<tr align="center">
<td><img width="260" alt="Install" src="https://github.com/user-attachments/assets/fabfd1ac-ca6a-43a4-86cd-c63bb80317b0" /></td>
<td><img width="260" alt="Model fleet" src="https://github.com/user-attachments/assets/63662c5f-2b05-4935-ac14-6a131767c8f5" /></td>
<td><img width="260" alt="Slash commands" src="https://github.com/user-attachments/assets/52ca6de0-0958-4237-9dfd-776c9e55822d" /></td>
</tr>
</table>

</div>
---

## Memory & self-improving agents 🧠
The [QOPC] System watches what you accept, revise, publish, or discard, and tunes its own prompt weights. Your AI gets measurably better the more you use it — no config, no fine-tuning.

---

## Two brains, one terminal

The agent runs on either brain through the **same** host loop, render, tools, and commands — so local and hosted behave identically. Switching just swaps the transport.

| | **API** (default) | **Local** (`--local`) |
|---|---|---|
| Runs on | Aether's hosted API | your machine, via Ollama |
| Models | full Aether fleet + Neo / Kronus | any Ollama model you've pulled |
| Login | your Aether account | none — fully offline |
| Your code | stays local; only the prompt + context you send leaves | never leaves the machine |
| Metering | UVT usage meter + signed receipts | none — it's your hardware |

## Common commands

```bash
aether agent [flags] "<task>"     # the autonomous agent (see flags below)
aether models                    # list models + orchestrators
aether auth login                # sign in for the API path
aether resume                    # replay / continue the last session (offline)
aether config set defaultModel opus
```

| `aether agent` flag | What it does |
|---|---|
| `--local` | Use the local Python/Ollama brain instead of the API. |
| `--model <id>` | Force a model (e.g. `--model opus`, or an Ollama tag with `--local`). |
| `--effort <tier>` | Budget ceiling: `LOW` · `MED` · `MAX` · `ULTRA` · `CODEPRO`. |
| `--test-cmd <cmd>` | Command the verification gate runs (default `pytest -q`). |
| `--worktree` | Run in a fresh git worktree on an auto-named branch (isolated). |
| `--repo <owner/name>` | Clone a GitHub repo via your own `gh`/`git` auth, work it in a worktree. |
| `--interactive` | Pause at each stage boundary to type a steer (TTY only). |
| `-y`, `--yes` | Auto-confirm prompts (non-interactive). |

Inside the REPL, `/` commands control the session — grouped into **Session** (`/model` `/agent` `/tier` `/audit` `/doctor`), **Agent modes** (`/recon` `/plan` `/review` `/autonomous-execution` …), **Steering** (`/queue` `/steer` `/btw`), **Context & limits** (`/pin` `/snapshot` `/limit` `/rollback`), **Goals & workflows** (`/goal` `/workflow`), **Vault** (`/vault*`), and **Orchestra** (`/delegate` `/tree` `/broadcast` `/gather`). Run `/help` to see them all.

**Full reference:** every command, flag, slash command, and env var lives in [COMMANDS.md](COMMANDS.md). Dated patch notes live in [docs/releases/](docs/releases/).

---

## Pricing & UVT

AetherCloud runs on the shared Aether platform — **one account, one balance, one
bill**, shared with [Aether Code](https://github.com/DBarr3/aether-agent) and your
Aether AI on the web.

| Tier | For |
|---|---|
| **Free** | Try it — no card required. Download and run in about a minute. |
| **Subscription** | Unlock the premium models and orchestrators. |
| **UVT credits** | Pay-as-you-go usage credits — top up anytime, spend across the whole platform. |

**UVT** is the universal usage credit that meters every model call across
AetherCloud, Aether Code, and the web, so cost is visible as it happens.

➡ **Current tiers, prices, and credit amounts:** [aethersystems.net/pricing](https://aethersystems.net/pricing)

---

## Quickstart

```bash
npm i -g aether-agent                # needs Node >= 20

# Path A — hosted models (sign in once):
aether auth login                    # authorize at aethersystems.net
aether agent "refactor src/auth.ts to async/await and add tests"

# Path B — fully local, no account, no network:
ollama pull qwen2.5-coder:7b
aether agent --local "same task, offline"

> **Other installers:** `curl -fsSL https://aethersystems.net/install.sh | sh` (macOS/Linux/WSL) · `irm https://aethersystems.net/install.ps1 | iex` (Windows PowerShell). They just verify Node and run the npm install — no native deps, no daemon.

## Three ways to run it

```bash
aether                                 # interactive REPL — chat + /slash commands
aether "explain src/router.ts"         # one-shot answer, then exit
aether agent "fix the failing tests"    # autonomous agent: edits files + verifies
``` 
```bash
aether agent "refactor src/auth.ts"            # API brain
aether agent --local "refactor src/auth.ts"    # local brain
```

## Security

- **Your code stays local.** Edits apply on your machine, path-guarded — the client refuses to write outside your working directory. On the API path only the prompt and context you send leave; on `--local`, nothing leaves at all.
- **Verification is ground truth.** The host runs your test command and reads the exit code itself; "done" is never the model's word.
- **Tokens are credentials.** Stored `chmod 600`, never committed; `aether auth logout` clears them.
- **The server is the authority.** On the API path, usage limits, model access, and signing (chain-of-custody receipts) are enforced server-side — the client only displays what the server reports.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Part of the Aether platform

Aether Agent is the **terminal sibling** of **[AetherCloud](https://github.com/DBarr3/aethercloud)**, the agentic desktop app — same login, same UVT balance, same model fleet. Drive your repo from the command line; drive projects, workflows, and the memory Vault from the desktop. **One account runs both,** and your balance and context follow you across terminal, desktop, and your Aether AI on the web.


## Get AetherCloud

1. Go to **[aethersystems.net/download](https://aethersystems.net/download)**.
2. Run the installer and accept the consent checkbox.
3. You're in — installs in about a minute, no card needed.
4. Sign in with your Aether account to unlock your models, Vault, and balance.

---

## License

Apache-2.0 — use it, fork it, ship it. The license covers the code, not the Aether name or hosted service ([LICENSE](LICENSE) · [NOTICE.md](NOTICE.md)). PRs and issues welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

Built by **Aether AI** · [aethersystems.net](https://aethersystems.net)

*One terminal. Frontier models or fully local. Your code stays yours.*

</div>
