<div align="center">

# Aether Agent

**An open-source coding agent for your terminal — runs on hosted frontier models or fully offline on your own machine.**

[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE) [![Node](https://img.shields.io/badge/node-%E2%89%A520-14b8a6)](https://nodejs.org) [![Built by Aether](https://img.shields.io/badge/built%20by-Aether-7c3aed)](https://aethersystems.net)

```bash
npm i -g aether-agent     # or run once: npx aether-agent
```

</div>

<!-- ── Aether Agent Terminal Card ── -->
<div align="center">
<div style="
  display:inline-block; margin:12px 0 24px; border-radius:18px; overflow:hidden;
  background:linear-gradient(180deg, #04161e 0%, #020e15 100%);
  border:1px solid #1a3a44; box-shadow:0 30px 80px -40px rgba(0,0,0,0.8);
  max-width:720px; width:100%; text-align:left;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
">

<!-- title bar -->
<div style="
  display:flex; align-items:center; gap:8px;
  padding:14px 18px; background:#020d14; border-bottom:1px solid #1a3a44;
">
  <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>
  <span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span>
  <span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
  <span style="margin-left:10px;color:#6f93a0;font-size:13px;letter-spacing:.04em">aether agent — coding session</span>
  <span style="margin-left:auto;color:#4a6873;font-size:12px">v0.1.0</span>
</div>

<!-- header -->
<div style="padding:32px 28px 24px;text-align:center;border-bottom:1px dashed #1e4a54;background:radial-gradient(ellipse 600px 180px at 50% 0%, rgba(34,211,238,0.08),transparent 70%)">
  <!-- pixel cloud -->
  <div style="display:flex;justify-content:center;margin-bottom:10px">
    <svg width="88" height="72" viewBox="0 0 88 72"><rect x="24" y="0" width="24" height="8" fill="#03A9F4" rx="1"/><rect x="16" y="8" width="56" height="8" fill="#03A9F4" rx="1"/><rect x="8" y="16" width="72" height="8" fill="#03A9F4" rx="1"/><rect x="0" y="24" width="88" height="8" fill="#03A9F4" rx="1"/><rect x="0" y="32" width="88" height="8" fill="#03A9F4" rx="1"/><rect x="0" y="40" width="88" height="8" fill="#03A9F4" rx="1"/><rect x="8" y="48" width="72" height="8" fill="#03A9F4" rx="1"/><rect x="16" y="56" width="16" height="8" fill="#81D4FA" rx="1"/><rect x="40" y="56" width="16" height="8" fill="#81D4FA" rx="1"/><rect x="24" y="64" width="40" height="8" fill="#03A9F4" rx="1"/></svg>
  </div>
  <!-- AETHER logo -->
  <div style="font-family:'Courier New',monospace;font-size:38px;font-weight:800;letter-spacing:12px;color:#38bdf8;text-shadow:0 0 40px rgba(56,189,248,0.4)">AETHER</div>
  <p style="margin:16px auto 0;max-width:600px;font-size:14.5px;line-height:1.65;color:#9fc0cc">
    An open-source coding agent for your terminal — <strong style="color:#38bdf8">cloud</strong> or <strong style="color:#22d3ee">--local</strong>.
    It scans, plans, edits, and runs your tests on its own.
    With <strong style="color:#22d3ee">QOPC</strong> 🧠 it learns from what you accept or discard — getting better the more you use it.
  </p>
</div>

<!-- agent strip -->
<div style="padding:20px 28px 0">
  <div style="font-size:12.5px;color:#6f93a0;margin-bottom:10px;display:flex;align-items:center;gap:8px">
    <span style="color:#6f93a0">aether agent</span>
    <code style="color:#22d3ee;font-weight:600;font-size:12px">/opus</code>
    <span style="color:#4a6873">·</span>
    <code style="color:#22d3ee;font-weight:600;font-size:12px">/effort</code>
    <span style="color:#6f93a0">code-pro</span>
    <span style="color:#4a6873;margin-left:auto">refactor src/auth.ts → async/await + tests</span>
  </div>
  <div style="background:transparent;padding:2px 0;font-family:'Courier New',monospace;font-size:12px;line-height:1.7">
    <div style="color:#22d3ee;font-weight:700;margin:4px 0">==[ SCAN ]== <span style="font-weight:400;color:#4a6873">(๑•ᴗ•)ﻭ✎</span></div>
    <div style="padding-left:18px;color:#6f93a0">- mapping imports of src/auth.ts</div>
    <div style="padding-left:18px"><span style="color:#38bdf8">read_file</span><span style="color:#6f93a0">  src/auth.ts · 142 lines · 4 callbacks</span></div>
    <div style="padding-left:18px"><span style="color:#38bdf8">grep_symbol</span><span style="color:#6f93a0">  find all callers before the rewrite</span></div>
    <div style="padding-left:18px"><span style="background:rgba(52,211,153,0.12);color:#34d399;font-weight:700;padding:1px 6px;border-radius:4px">[OK]</span> <span style="color:#cfeef4">mapped 2 files · 7 call sites</span> <span style="color:#4a6873">(stage complete)</span></div>
    <div style="color:#22d3ee;font-weight:700;margin:8px 0 4px">==[ REASON ]== <span style="font-weight:400;color:#4a6873">(๑•ᴗ•)ﻭ✎</span></div>
    <div style="padding-left:18px;color:#6f93a0">- planning the async/await conversion</div>
    <div style="padding-left:18px;color:#4a6873;font-style:italic;border-left:2px solid #1e4a54;margin:4px 0;padding:6px 10px;background:rgba(34,211,238,0.04);border-radius:0 6px 6px 0">the task is an async/await refactor... converting callbacks naively would drop the error path, so each await needs a try/catch... confidence on the plan: 0.93 → accept.</div>
    <div style="padding-left:18px"><span style="background:rgba(52,211,153,0.12);color:#34d399;font-weight:700;padding:1px 6px;border-radius:4px">[OK]</span> <span style="color:#cfeef4">plan locked · 4 hunks + 1 test file</span> <span style="color:#4a6873">(converged)</span></div>
    <div style="color:#22d3ee;font-weight:700;margin:8px 0 4px">==[ VERIFY ]== <span style="font-weight:400;color:#4a6873">(๑•ᴗ•)ﻭ✎</span></div>
    <div style="padding-left:18px;color:#6f93a0">- host runs your test command — exit code is ground truth</div>
    <div style="padding-left:18px"><span style="background:rgba(52,211,153,0.12);color:#34d399;font-weight:700;padding:1px 6px;border-radius:4px">[OK]</span> <span style="color:#cfeef4">6 passed in 0.42s</span> <span style="color:#4a6873">(green)</span></div>
  </div>
  <!-- context bar -->
  <div style="margin-top:12px;padding-top:10px;border-top:1px dashed #1e4a54;display:flex;align-items:center;gap:10px;font-size:12px;color:#6f93a0">
    <span style="color:#4a6873">anchoring context _ϕ(°-°=)</span>
    <div style="flex:1;height:8px;border-radius:3px;background:#020d14;border:1px solid #1a3a44"><div style="width:35%;height:100%;background:linear-gradient(90deg,#2dd6ee,#4ea8ff);border-radius:2px;box-shadow:0 0 8px rgba(34,211,238,0.5)"></div></div>
    <span style="color:#22d3ee">412.6M / 1.17B</span>
  </div>
</div>

<!-- install cards -->
<div style="padding:22px 28px 24px;border-top:1px dashed #1e4a54">
  <div style="text-align:center;margin-bottom:16px">
    <div style="font-size:17px;font-weight:600;color:#eafafe">Install in three moves</div>
    <div style="font-size:12px;color:#4a6873;margin-top:4px">pick a brain — hosted or local, both behave identically</div>
  </div>
  <table style="width:100%;border-collapse:separate;border-spacing:12px;table-layout:fixed"><tr>
    <td style="width:33%;vertical-align:top;background:rgba(8,28,38,0.7);border:1px solid #1a3a44;border-radius:12px;padding:14px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#22d3ee,transparent);opacity:.4"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="color:#22d3ee">⬇</span><span style="font-size:10px;letter-spacing:.14em;color:#22d3ee;font-weight:700">INSTALL</span></div>
      <div style="font-size:15px;font-weight:600;color:#eafafe;margin-bottom:3px">Drop it in</div>
      <div style="font-size:11px;color:#6f93a0;line-height:1.4;margin-bottom:10px">one global install · Node ≥ 20</div>
      <div style="background:rgba(2,12,18,0.6);border:1px solid #1a3a44;border-radius:7px;padding:10px;font-family:'Courier New',monospace;font-size:12px;color:#bfeaf2"><span style="color:#4a6873">$ </span>npm i -g aether-agent</div>
      <div style="margin-top:8px;font-size:11px;color:#4a6873"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#34d399;margin-right:6px"></span>or curl install.sh · no native deps</div>
    </td>
    <td style="width:33%;vertical-align:top;background:rgba(8,28,38,0.7);border:1px solid #1a3a44;border-radius:12px;padding:14px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#22d3ee,transparent);opacity:.4"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="color:#22d3ee">☁</span><span style="font-size:10px;letter-spacing:.14em;color:#22d3ee;font-weight:700">HOSTED</span></div>
      <div style="font-size:15px;font-weight:600;color:#eafafe;margin-bottom:3px">Run on the fleet</div>
      <div style="font-size:11px;color:#6f93a0;line-height:1.4;margin-bottom:10px">Claude · GPT · DeepSeek · Neo</div>
      <div style="background:rgba(2,12,18,0.6);border:1px solid #1a3a44;border-radius:7px;padding:10px;font-family:'Courier New',monospace;font-size:12px;color:#bfeaf2"><span style="color:#4a6873">$ </span>aether auth login<br><span style="color:#4a6873">$ </span>aether agent <span style="color:#38e6f0">"refactor src/auth.ts"</span></div>
      <div style="margin-top:8px;font-size:11px;color:#4a6873"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#34d399;margin-right:6px"></span>your code stays local — only context leaves</div>
    </td>
    <td style="width:33%;vertical-align:top;background:rgba(8,28,38,0.7);border:1px solid #1a3a44;border-radius:12px;padding:14px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#22d3ee,transparent);opacity:.4"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="color:#22d3ee">🏠</span><span style="font-size:10px;letter-spacing:.14em;color:#22d3ee;font-weight:700">LOCAL</span></div>
      <div style="font-size:15px;font-weight:600;color:#eafafe;margin-bottom:3px">Go fully offline</div>
      <div style="font-size:11px;color:#6f93a0;line-height:1.4;margin-bottom:10px">any Ollama model · no account or network</div>
      <div style="background:rgba(2,12,18,0.6);border:1px solid #1a3a44;border-radius:7px;padding:10px;font-family:'Courier New',monospace;font-size:12px;color:#bfeaf2"><span style="color:#4a6873">$ </span>ollama pull qwen2.5-coder:7b<br><span style="color:#4a6873">$ </span>aether agent --local <span style="color:#38e6f0">"same task"</span></div>
      <div style="margin-top:8px;font-size:11px;color:#4a6873"><span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#34d399;margin-right:6px"></span>nothing leaves the machine</div>
    </td>
  </tr></table>
</div>

<!-- bottom bar -->
<div style="margin:0 28px 24px;padding:12px 16px;background:rgba(2,12,18,0.55);border:1px solid #1a3a44;border-radius:12px;display:flex;align-items:center;gap:12px">
  <svg width="20" height="20" viewBox="0 0 24 24" style="fill:#d2ecf3;flex-shrink:0"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
  <div style="flex:1"><strong style="color:#eafafe;font-size:14px">View the source on GitHub</strong><br><span style="font-size:11px;color:#6f93a0">star it, fork it, ship it</span></div>
  <a href="https://github.com/DBarr3/aether-agent" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #1e4a54;border-radius:8px;font-family:'Courier New',monospace;font-size:12px;color:#22d3ee;text-decoration:none">github.com<span style="color:#4a6873">→</span></a>
</div>

<!-- footer note -->
<div style="margin:0 28px 14px;text-align:center;font-size:11px;color:#4a6873">
  <a href="display/index.html" style="color:#22d3ee;text-decoration:none">▶ open interactive version</a> &nbsp;·&nbsp; <a href="https://htmlpreview.github.io/?https://github.com/DBarr3/aether-agent/blob/main/display/index.html" style="color:#4a6873;text-decoration:none">live preview</a>
</div>

</div>
</div>

---

## What it is

Aether Agent reads your code, plans, edits files, runs your tests, and fixes what broke — right in your terminal, showing its work as it goes. Like Claude Code or Aider, but with two differences that matter:

- **Model-agnostic.** Sign in to use Aether's hosted fleet (Claude, GPT, DeepSeek, Kimi, Gemma + the **Neo** and **Kronus** orchestrators) — or run `--local` on **Ollama** with no account and no network at all.
- **Verification is ground truth.** When a run finishes, the host runs *your* test command itself and reads the exit code. A green result means your tests actually passed — it's never the model's word for it.

Either way it's a thin client: edits apply to **your** files on **your** disk, path-guarded. Your repository is never uploaded.

## Memory & self-improving agents 🧠 QOPC
The Quantum Optimized Prompt Circuit watches what you accept, revise, publish, or discard, and tunes its own prompt weights. Your AI gets measurably better the more you use it — no config, no fine-tuning.

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

---

## Models

**API models** (sign in). Your exact roster depends on your plan — `aether models` is the live source of truth:

```bash
aether models                  # every model + orchestrator on your tier
aether models use sonnet       # set your default
```

### Text models

| Model | Provider | Input $/1M | Output $/1M | UVT mult. | Tiers |
|---|---|:---:|:---:|:---:|---|
| **Claude Haiku 4.5** | Anthropic | $0.80 | $4.00 | 0.25× | free+ |
| **Claude Sonnet 4.6** | Anthropic | $3.00 | $15.00 | 1.0× | solo+ |
| **Claude Opus 4.7** | Anthropic | $15.00 | $75.00 | 5.0× | pro+ |
| **GPT-5.5** | OpenAI | $5.00 | $30.00 | 1.2× | pro+ |
| **GPT-5.4 mini** | OpenAI | $0.75 | $4.50 | 0.3× | solo+ |
| **DeepSeek V4 Flash** | DeepSeek | $0.14 | $0.28 | 0.4× | free+ |
| **DeepSeek V4 Pro** ¹ | DeepSeek | $1.74 | $3.48 | 0.5× | pro+ |
| **Kimi K2.6** | Moonshot | $0.74 | $3.50 | 0.30× | pro+ |
| **Gemma 4 31B** | Google | $0.12 | $0.37 | 0.03× | pro+ |
| **Gemma 4 31B Free** | Google | free | free | 0.00× | free+ |

¹ Reasoning model with hidden thinking tokens.

### Image generation

| Model | Per image UVT | Tiers |
|---|---|---|
| **Nano Banana Pro** | 3,900–24,000 | free+ |
| **Recraft V3** (raster / vector) | 4,000 / 8,000 | free+ |
| **GPT Image 2** | 530–21,100 | free+ |

### Video generation

| Model | Per second UVT | 5s clip UVT | Tiers |
|---|---|:---:|---|
| **Seedance 2.0** | 24,200–68,200 | 121,000 | pro+ |
| **Veo 3.1** (+audio default) | 10,000–35,000 | 75,000 | pro+ |
| **Kling 2.5 Turbo Pro** | 7,000 | 35,000 | pro+ |
| **HunyuanVideo 1.5** | — | — | pro+ |
| **Hunyuan3D 2.1** | — | — | pro+ |

### Orchestrators

| Orchestrator | What it does | Tiers |
|---|---|---|
| **Neo** (v5.1t) | Plans + fans out sub-agents for coding tasks | solo+ |
| **Kronus** (v2.4) | Deep multi-agent audits + automated fix | pro+ |
| **Aether-Vision** | Chains image → video models from one prompt | pro+ |

```bash
aether run neo "add pagination to the users endpoint and write tests"
aether run kronus "audit this service for race conditions and fix them"
aether image "a cyberpunk cityscape at dusk" --model nano_pro
aether video "5s cinematic pan over the city" --model seedance
```

**Local models** (`--local`). The same terminal driving a headless Python brain on [Unlimited Context](https://github.com/DBarr3/Unlimited-Context), inferring through Ollama — no account, no network.

| Local model | Size | Notes |
|---|---|---|
| `qwen2.5-coder:7b` | ~4.7 GB | Universal default — fits an 8 GB GPU, best small-model tool use |
| `gemma3:4b` | ~3.3 GB | Lighter option (`gemma3n:e4b` for the efficient variant) |
| `qwen3-coder:30b` | ~24 GB | For depth — needs ~24 GB RAM/VRAM |

```bash
ollama pull qwen2.5-coder:7b
aether agent --local --model qwen3-coder:30b "add a retry with backoff"
```

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

## Embed the core

The CLI is a thin terminal frontend over a small, typed client. Import it and route any surface — desktop app, web chat, your own tool — through the same path.

```ts
import { createClient } from "aether-agent";

const aether = createClient({ token: process.env.AETHER_TOKEN });

for await (const frame of aether.chatStream("Summarize this diff", { model: "sonnet" })) {
  if (frame.type === "delta") process.stdout.write(frame.text);
}

const { models } = await aether.catalog();   // same /models menu, one source
```

The headless-brain ↔ host event protocol is documented and open — see [docs/BRIDGE_PROTOCOL.md](docs/BRIDGE_PROTOCOL.md).

---

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
