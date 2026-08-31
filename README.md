<div align="center">

# Aether Agent

**An open-source terminal coding agent for working in a local repository with hosted models or local Ollama.**

[![CI](https://github.com/AetherAI3/aether-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/AetherAI3/aether-agent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/aether-agents?label=npm)](https://www.npmjs.com/package/aether-agents)
[![Node 24+](https://img.shields.io/badge/node-24%2B-14b8a6)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-06b6d4)](LICENSE)

[Quickstart](#quickstart) · [Model routes](#choose-a-model-route) · [Workflow](#coding-workflow) · [Availability](#availability-and-product-boundaries) · [Security](#security-and-local-authority) · [Develop](#development)

</div>

Aether Agent is a standalone TypeScript CLI. It plans and edits in the selected
checkout, runs repository tools on the local host, records project sessions, and
ties completion to verification evidence. It is independently installable and
runnable as an engineering artifact; it is not a backend component that requires
a Desktop product. Source and package availability do not make the end-to-end
product journey complete; its canonical product state is **Preview / HOLD**.

<!-- SOURCE-0.3-WORKFLOWS:START -->

> **Requires 0.3.0 or newer.** Check the installed CLI with `aether --version`.

## Quickstart

Install the published package from npm in the repository you want to work on:

```bash
npm install -g aether-agents@latest --ignore-scripts
aether --version
```

Node.js 24 or newer is required. The package name is `aether-agents`; the
installed executable is `aether` (with `aether-agent` as an alias).

For a local Ollama run:

```bash
aether setup --local
aether local pull qwen2.5-coder:7b --yes
aether local use qwen2.5-coder:7b --yes
aether agent --local --test-cmd "npm test" "fix the failing test"
```

For source-level hosted-route inspection, sign in and inspect what the service
exposes to the account:

```bash
aether auth login
aether models
aether agent --test-cmd "npm test" "fix the failing test"
```

Hosted Agent is **Coming later / HOLD** as described below. Authentication, a
model catalogue, and client commands are integration evidence; they do not prove
that the service-side coding-session capability or a complete hosted journey is
enabled.

The repository also contains [`install.sh`](install.sh) and
[`install.ps1`](install.ps1). Inspect either script before running it. These are
CLI installers; they are not evidence of a Desktop runtime installation.

## Choose a model route

Both routes keep repository tools, permission decisions, session records,
review, and verification on the CLI host. The difference is where inference
runs.

### Local Ollama

The local route requires no Aether account. With Ollama at its default
`http://localhost:11434` endpoint, prompts and model inference can remain on the
machine after Ollama and the selected model are downloaded. If `OLLAMA_HOST`
points elsewhere, prompts go to that configured endpoint. Separately enabled
network tools can still use the network.

### Hosted Aether API — Coming later / HOLD

Hosted runs send the task and context supplied to the configured Aether API;
file, shell, Git, and verification operations still execute through the local
host. Hosted model visibility and entitlement are account- and service-
dependent, so `aether models` is the live catalogue for the signed-in account.

Hosted coding additionally requires the service to advertise the local-
authority coding protocol. The v0.3.0 release evidence records production Agent
DevSessions as disabled. When that capability is absent, the CLI fails closed
instead of silently turning a coding task into server-side chat. A successful
install or login therefore must not be presented as proof that hosted coding is
currently available.

No model count, context-window table, entitlement matrix, or price is pinned in
this README. Those are service data, not durable package facts.

The dated fallback below is catalogue evidence only. It is not an entitlement
or hosted-availability claim; `aether models` remains the signed-in account view.

<!-- MODEL-CATALOGUE:START -->
A dated, sanitized offline fallback snapshot is available as [HTML](docs/model-catalogue/index.html), [JSON](docs/model-catalogue/catalogue.json), and [Markdown](docs/generated/model-catalogue.md). It was generated at `2026-08-23T00:00:00.000Z` from Cloud public projection `model-catalogue-v1` with verified digest `sha256:80ba3ba1144d301e2cca407ceced74cb2b371f1da6e3982b87305ff12a3d4712`. Listed availability is not an account entitlement; use `aether models` while signed in.
<!-- MODEL-CATALOGUE:END -->

## Coding workflow

### Local repository tools

The agent can use file, search, shell, Git, and review tools against the selected
workspace. Host-side path and permission checks remain authoritative for both
model routes. A hosted model can request a tool action; it cannot move that tool
execution to the service.

### Sessions and explicit handoffs

`aether sessions` lists project-scoped session records, and `aether resume`
continues or exports supported session state. Portable handoffs are explicit
files intended for review and transfer between CLI checkouts; they are not a
claim of automatic cloud or Desktop memory synchronization.

### Skills

`aether skills` discovers and manages packaged, project, and user Skills.
Selected Skills and repository instructions participate in real runs. Skill
policy can narrow the host permission envelope but cannot grant authority that
the host did not already allow. Use `aether skills list` and
`aether capabilities` to inspect the effective local installation.

### Verify, review, and ship

Pass `--test-cmd` to bind completion to a real local command and exit code. A
later repository change makes earlier verification evidence stale.

`aether review` inspects the current diff and verification state. `aether ship`
previews the branch, commit, destination, and pull-request plan and requires the
relevant Git, GitHub, and publication approvals. Installing the package does not
grant publication authority.

## Core commands

| Command | Purpose |
|---|---|
| `aether agent [task]` | Run a one-shot coding task or open the REPL. |
| `aether agent --local [task]` | Run through the configured Ollama endpoint. |
| `aether models` | Show hosted models visible to the signed-in account. |
| `aether local doctor\|models\|use\|pull` | Diagnose and manage local Ollama. |
| `aether sessions` / `aether resume` | Inspect and continue project sessions or create an explicit handoff. |
| `aether skills` / `aether capabilities` | Inspect Skills and the effective capability set. |
| `aether review` | Inspect changes and current verification evidence. |
| `aether ship` | Preview and approve branch and pull-request publication. |
| `aether mcp` | Inspect and diagnose configured MCP servers. |
| `aether doctor` | Diagnose the local installation and configured routes. |

Use `aether help <command>` or [COMMANDS.md](COMMANDS.md) for the complete
command and flag reference.

## Availability and product boundaries

| Surface or capability | Status | Evidence-bounded meaning |
|---|---|---|
| Standalone local Agent journey | **Preview / HOLD** | Current `main` and package metadata provide a 0.3.0 engineering implementation of local repository tools, sessions, Skills, verification, review, ship, and Ollama routing. That source/package availability is subordinate evidence, not proof of a complete J2 product journey. |
| Local Ollama route | **Preview / HOLD** | The engineering path uses the configured Ollama endpoint and does not require an Aether account. Offline behavior assumes a loopback endpoint, a downloaded model, and no separately enabled network action. |
| Hosted Agent | **Coming later / HOLD** | Client integration exists, but the complete hosted product journey is not available. It requires account access, model entitlement, and the service-side local-authority coding capability; the v0.3.0 release records production Agent DevSessions as disabled, with fail-closed client behavior. |
| Desktop integration | **Preview / HOLD** | Source-level embedding and installer/staging integration points exist. This audit did not establish a clean-install Desktop runtime that bundles, configures, authenticates, or launches a compatible CLI. Aether Agent remains a standalone product. |
| Start in Agent, then continue on web/Desktop with the same memory | **Coming later / HOLD — unproved** | No clean-install runtime evidence established this path. Supported CLI sessions and explicit portable handoffs do not prove cross-product shared-memory continuation. |

<!-- SOURCE-0.3-WORKFLOWS:END -->

## Package and source truth

The live registry and the repository are separate release surfaces. A source
version does not prove that npm's `latest` dist-tag points to the same version,
and a package version does not prove that an account-dependent service
capability is enabled.

| Install | Version | What it represents |
|---|---:|---|
| npm `latest` | [![npm latest](https://img.shields.io/npm/v/aether-agents?label=&color=14b8a6)](https://www.npmjs.com/package/aether-agents) | Published package selected by the live `latest` dist-tag. |
| `main` source build | **0.3.0** | Current repository package metadata and source workflows. |

Check the exact artifacts you are about to use:

```bash
npm view aether-agents name version engines repository license dependencies
aether --version
```

The current `main` manifest declares Node.js 24 or newer, Apache-2.0, the
canonical `AetherAI3/aether-agent` repository, and no runtime dependencies.
TypeScript and Node types are development dependencies.

To build current source:

```bash
git clone https://github.com/AetherAI3/aether-agent.git
cd aether-agent
npm ci --ignore-scripts
npm run build
npm link
```

See the [v0.3.0 release](https://github.com/AetherAI3/aether-agent/releases/tag/v0.3.0)
and [release notes](RELEASE_NOTES.md) for dated evidence. Dated records describe
what was true when written; query npm for current registry state.

The cross-repository public status and J2 verdict are controlled by the
[Aether Product Truth registry](https://github.com/AetherAI3/AETHER-CLOUD/tree/main/docs/product-truth).
That evidence layer can qualify documentation claims; it never grants hosted,
local, account, billing, or runtime authority.

## Security and local authority

- File tools are confined to the selected workspace. Write, shell, Git,
  network, and publication actions pass through host-side permission gates.
- Hosted tasks and supplied context go to the configured Aether API, while
  repository tools and checks run locally. The coding route fails closed when
  the service cannot honor that contract.
- Ollama prompts go to the configured endpoint. The default is loopback;
  offline use also requires avoiding separately permissioned network tools.
- Credentials and session records live outside the repository. Review any
  exported handoff before sharing it.
- `aether ship` does not treat `--yes` alone as publication authority.

Read [SECURITY.md](SECURITY.md) for the supported-version policy, security
boundary, and private vulnerability-reporting path.

## Development

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run smoke
npm run verify:production
npm run docs:check
npm run release:truth
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and
[`docs/PRODUCTION_OPERATIONS.md`](docs/PRODUCTION_OPERATIONS.md) for operator
checks.

## License

Apache-2.0 — use it, fork it, and ship it. The license covers the code, not the
Aether name or hosted service ([LICENSE](LICENSE) · [NOTICE.md](NOTICE.md)).
