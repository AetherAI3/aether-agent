<div align="center">

# Aether Agent

**One coding agent. Hosted frontier models or fully local Ollama. Your tests decide when it’s done.**

[![CI](https://github.com/AetherAI3/aether-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/AetherAI3/aether-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/aether-agents?label=npm)](https://www.npmjs.com/package/aether-agents)
[![Release notes](https://img.shields.io/badge/release-notes-7c3aed)](RELEASE_NOTES.md)
[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-14b8a6)](https://nodejs.org/)
[![Security policy](https://img.shields.io/badge/security-policy-7c3aed)](SECURITY.md)

[Start](#choose-how-to-run) · [Proof](#a-sixty-second-proof) · [Commands](#essential-commands) · [Security](#security-and-runtime-boundaries) · [Contribute](CONTRIBUTING.md)

</div>

Aether Agent is an open-source coding CLI. It can inspect and edit a repository,
run commands, keep local session records, and run a verification command after the
agent finishes. The same TypeScript host drives the hosted and Ollama paths; the
selected brain changes, but workspace checks, tool execution, review, session, and
verification code remain local.

## Published package versus current source

These are different product surfaces today:

| Install | Version | Safe starting point |
|---|---:|---|
| npm `latest` | **0.1.0** | Published baseline: sign in, inspect models, and use chat. |
| `main` source build | **0.3.0** | The coding, Ollama, doctor repair, handoff, review, session, skill, and ship workflows documented below. |

> **Check before continuing:** npm `latest` currently resolves to **0.1.0**. That
> build does not contain the source-only workflows in this README. Use the source
> build below, or wait until `aether --version` reports a published **0.3.x**
> release, before following any section labeled “source 0.3.0.”

This split is backed by the committed [0.3.0 release record](docs/releases/2026-08-22.md):
`main` is 0.3.0, while the last recorded npm `latest` is 0.1.0. Publishing is an
owner-controlled operation, so source presence is not registry availability.

## Install

Node.js 24 or newer is required.

Install the current published npm baseline:

```bash
npm install -g aether-agents@latest --ignore-scripts
aether --version # expected from npm latest today: 0.1.0
aether auth login
aether chat "hello"
```

To run the current source instead:

```bash
git clone https://github.com/AetherAI3/aether-agent.git
cd aether-agent
npm ci --ignore-scripts
npm run build
npm link
```

The source repository is
[`AetherAI3/aether-agent`](https://github.com/AetherAI3/aether-agent), with bugs and
feature requests in its [issue tracker](https://github.com/AetherAI3/aether-agent/issues).
The package is [`aether-agents`](https://www.npmjs.com/package/aether-agents).

<!-- SOURCE-0.3-WORKFLOWS:START -->

> **Requires the 0.3.0 source build above, or a future published 0.3.x release.**
> A clean npm `latest` install still reports 0.1.0 and does not have the complete
> command/flag surface used below.

## Choose how to run — source 0.3.0

### Hosted Aether account

```bash
aether auth login
aether auth status
aether agent --test-cmd "npm test" "fix the failing test"
```

`aether auth login` starts device authorization and stores the resulting credential
locally. A signed-in coding run requests a hosted dev session while tool execution
and verification stay in the checkout. Hosted coding availability is determined at
runtime: if the service does not provide the required local-authority protocol, the
CLI reports routing drift and exits with code `3` without falling back to server-side
tool execution.

Use `aether models` to inspect the catalogue returned for the signed-in account.

<!-- MODEL-CATALOGUE:START -->
A dated, sanitized offline fallback snapshot is available as [HTML](docs/model-catalogue/index.html), [JSON](docs/model-catalogue/catalogue.json), and [Markdown](docs/generated/model-catalogue.md). It was generated at `2026-08-23T00:00:00.000Z` from Cloud public projection `model-catalogue-v1` with verified digest `sha256:2bd01b255f3a7a5ff5f6c3d098dd6d3483b678359ab377c2c5f5b31faddabc9d`. Listed availability is not an account entitlement; use `aether models` while signed in.
<!-- MODEL-CATALOGUE:END -->
Model availability and service terms are server-owned and are intentionally not
copied into a hand-maintained table here.

### Fully local Ollama, no Aether account

Install [Ollama](https://ollama.com/) and keep it running. On Windows and macOS,
launch the Ollama app first; it normally owns the background server. On a headless
machine, `ollama serve` stays in the foreground, so run it by itself in terminal 1:

```bash
ollama serve
```

In terminal 2 (PowerShell, Command Prompt, or a POSIX shell), diagnose the signed-out
path, pull a model with explicit approval, select it, and start the agent:

```bash
aether setup --local
aether local pull qwen2.5-coder:7b --yes
aether local use qwen2.5-coder:7b --yes
aether agent --local --test-cmd "npm test" "fix the failing test"
```

`aether local doctor` is read-only; `aether local models` lists installed tags as
namespaced ids such as `ollama:qwen2.5-coder:7b`. Pulls and configuration writes
always display a plan and require `--yes` or an interactive confirmation. Selecting
a model does not switch the configured backend; use `--local` when you intend to run
it. Pass `--model ollama:<tag>` to select another installed model for one run (bare
tags remain accepted for compatibility only when `--local` explicitly makes the
intent clear). Auto-local fallback rejects a bare model id, and every hosted path
rejects `ollama:` ids before making a request. A saved hosted model id is never
forwarded to Ollama as a tag.

The local path
talks directly to the configured Ollama endpoint (by default
`http://localhost:11434`) and does not require an Aether account. `OLLAMA_HOST` may
point elsewhere, so "local" describes the selected backend, not a guarantee about a
user-supplied remote Ollama URL.

## A sixty-second proof — source 0.3.0

From a git repository, give the agent a small task and an explicit verification
command:

```bash
aether agent --local --test-cmd "npm test" "make one small change and keep the tests green"
aether review diff
aether sessions
```

The final status comes from the host-run command's exit code. Without `--test-cmd`,
the run is recorded as `unverified`, never as verified success.

Continue locally by session id, or export a bounded handoff for another checkout,
machine, or model:

```bash
aether resume export --out aether-handoff.json
aether agent --local --resume aether-handoff.json
```

When the branch is committed and ready, `aether ship` shows the complete publication
plan and asks before pushing and opening a pull request. Non-interactive publication
requires the explicit `--approve publish` authority; `--yes` alone is insufficient.

## What stays consistent

- **Verification is host-owned.** The configured test command is rerun after the
  model loop, and its real exit code determines the result.
- **Handoffs are portable.** `aether resume export` writes a bounded continuation
  record rather than copying the full transcript or repository contents.
- **One local host drives both paths.** Workspace confinement, permission prompts,
  local tools, session logging, and the final verification gate do not move into the
  model transport.
- **Capabilities stay visible.** `aether capabilities` reports the runtime contract;
  `aether skills` manages capability-scoped skill discovery and trust.

## Setup and diagnosis — source 0.3.0

```bash
aether doctor
aether doctor --live
aether doctor --fix --dry-run
```

The fast check inspects configured prerequisites. `--live` exercises reachable
services. Repair mode is limited to the doctor's registered repairs; preview it with
`--dry-run` before approving changes. Run `aether doctor --help` for the current
flags and checks.

## Essential commands — source 0.3.0

| Command | Purpose |
|---|---|
| `aether agent [task]` | Open the agent REPL or run a coding task. |
| `aether agent --local [task]` | Use the built-in Ollama brain. |
| `aether auth login` | Authorize a hosted account. |
| `aether models` | Read the current hosted model catalogue. |
| `aether doctor` | Inspect setup and optionally run live diagnostics. |
| `aether sessions` | Browse and continue project sessions. |
| `aether resume export` | Write a portable continuation file. |
| `aether review` | Inspect, stage, verify, or commit local changes. |
| `aether ship` | Push the current branch and open a pull request after approval. |
| `aether capabilities` | Show declared and currently available capabilities. |
| `aether skills` | Inspect and manage agent skills. |
| `aether support-bundle` | Export redacted diagnostics for support. |

Use `aether help`, `aether help <command>`, or the complete
[command reference](COMMANDS.md) for the complete surface. The README intentionally
keeps only the main path.

<!-- SOURCE-0.3-WORKFLOWS:END -->

## Security and runtime boundaries

- File tools are confined to the selected workspace. Write, shell, and git actions
  pass through the host permission gate.
- Hosted tasks and the context supplied for them are sent to the configured Aether
  API. A hosted coding run refuses a transport that cannot keep tool authority local.
- `--local` sends model requests to the configured Ollama endpoint. Network-capable
  tools remain separate actions; inspect prompts and configuration for your threat
  model.
- Credentials are stored outside the repository with owner-only permissions. Logout
  clears the local credential even if server revocation cannot be reached.
- Session logs are local and redact credential-shaped values. Portable handoffs are
  summaries, not repository snapshots.

For vulnerability reporting and supported-version policy, see
[SECURITY.md](SECURITY.md). Architecture and protocol contracts are documented in
[`docs/`](docs/).

## Other Aether surfaces

Aether web, Aether Code, Aether Design, and AetherCloud desktop are separate product
surfaces. This CLI does not currently expose a command that opens those surfaces or
redeems a coding session into them, so this README does not promise cross-surface
continuation. AetherCloud's source lives in
[`AetherAI3/aethercloud`](https://github.com/AetherAI3/aethercloud).

## Contributing and license

Run the same gates used for changes to this repository:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run smoke
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Security issues
follow [SECURITY.md](SECURITY.md), not the public issue tracker.

Apache-2.0 — use it, fork it, and ship it. The license covers the code, not the
Aether name or hosted service ([LICENSE](LICENSE) · [NOTICE.md](NOTICE.md)).
