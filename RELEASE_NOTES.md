# Aether Agent — August 2026 fleet update

**August 6, 2026**

The fleet is server-side, so everything below is already reachable from an
installed CLI — no client upgrade required. Run `aether models` to see what
your plan can select.

- **Six frontier models on Pro/Team** *(shipped July 25)* — **Claude Opus 5**
  (`opus5`), the full **GPT-5.6** family — Sol, Terra and Luna (`gpt56_sol`,
  `gpt56_terra`, `gpt56_luna`) — **Kimi K3** (`kimi_k3`) and **Gemini 3.6
  Flash** (`gemini36_flash`). Every one carries a million-token context window,
  and each has its own monthly spend ceiling. All six are additive: `--model
  opus` still resolves to Claude Opus 4.8.
- **GPT-5.6 opened to its true window** — the family is priced through the full
  1,050,000-token window with stepped rates, so prompts above 272k tokens are
  billed exactly rather than estimated.
- **Media fleet expanded to 32 models** *(shipped July 27)* — 15 image, 16 video
  and text-to-3D, up from the original eight. New in the terminal's `/photogen`,
  `/videogen` and `/storyboard` paths: FLUX.2 (Klein / Pro / Flex / Max),
  Nano Banana 2, Recraft V4, Seedream 4.5, Riverflow V2, GPT-5 Image, Sora 2 Pro,
  Kling 3.0 Pro, Kling Video O1, Wan 2.6 & 2.7, Hailuo 2.3, Grok Imagine and the
  Veo 3.1 Fast / Lite tiers. Image generation is Solo and up; video stays Pro/Team.
  *(Correction to the June notes below: the model shipped as `vision_kling` is
  **Kling 3.0 Standard** — the old "Kling 2.5 Turbo Pro" label named a model the
  backend does not call.)*
- **Media spend is checked before rendering, not after** — every generation is
  priced against your balance in a preflight, with a platform-wide kill switch.
  Costs are computed by the platform, never reported by the model.
- **Model selection validated on the automation path** — the loop path used to
  accept a caller-supplied model key unchecked; it is now validated against your
  entitlements like every other path.

---

## Aether Agent — July 2026 engineering update

**July 20, 2026**

- **TypeScript 7 native compiler** — repository builds are about 3.4x faster on
  the migration benchmark, with stricter whole-project checks enabled.
- **Cleaner npm package** — compiled tests no longer ship, the tarball is about
  26% smaller, and the CLI again has zero runtime dependencies.
- **ESM command reliability** — interactive media, workflow brainstorming,
  context purge, rollback, and revert no longer depend on unavailable CommonJS
  `require(...)` calls.
- **Public-repo cleanup** — internal execution notes and an unfiled third-party
  abuse-report draft were removed from the published source tree.

---

## Aether AI — June 2026 release

**June 9, 2026** — AetherCloud + Aether Agent

---

This release ships image & video generation, web chat becomes a workspace, the terminal grows into a full agent console, and memory now bridges every surface. Here's what landed.

---

## Aether-Vision — Media Generation

Eight models. One orchestrator. Zero compromises.

- **3 image models** — Nano Banana Pro, Recraft V3, GPT Image 2. Free tier gets a teaser; Solo and up get full access.
- **5 video & 3D models** — Seedance 2.0, Veo 3.1, Kling 2.5 Turbo Pro, HunyuanVideo 1.5, Hunyuan3D 2.1. Pro/Team only.
- **Aether-Vision orchestrator** — Pair a text reasoning brain with the vision fleet. One prompt plans, prompt-engineers, and generates in a single run.
- **Batch generation** — 1/2/4 variations per prompt, concurrent queueing. Keep chatting while renders finish.
- **Desktop picker + viFrontend bridge** — VISION section in the model picker, generated media auto-opens in the project media viewport.

## Web Chat — Now a Workspace

- **Workflows render live in chat** — Diagrams, step cards, structured output instead of a wall of text.
- **Artifact dock** — Files, diagrams, SVG previews, vault docs collect beside the conversation.
- **Inline image & video artifacts** — Generated media renders directly in the transcript with live progress.
- **Voice-to-text** — Press-to-talk mic in the composer on web and desktop.
- **Light / dark mode** — Surface-level toggle that remembers your choice.

## Aether Agent Terminal — Full Console

30+ new slash commands. The terminal is no longer just a chat window.

- **Session control** — `/pin`, `/drop`, `/snapshot`, `/limit`, `/audit-receipt`, `/rollback`, `/logs-view`. Snapshot to cloud, resume anywhere.
- **Agent modes** — `/queue`, `/steer`, `/btw`, `/writing-plans`, `/subagent-driven-execution`, `/autonomous-execution`, `/self-review`, `/recon`, `/plan`, `/research`, `/code-review`.
- **Orchestra** — `/delegate`, `/tree`, `/broadcast`, `/gather`. Tree-of-agents from one prompt. Pro/Team gated.
- **UVT & media commands** — Usage tracking plus image, video, and storyboard pipelines from the REPL.
- **Vault & MCP** — Browse vault notes in-terminal. Interactive MCP server manager.
- **Goal chains** — `/goal` and `/goals` track persistent multi-step tasks with phase boxes across sessions.
- **Terminal UX overhaul** — Cursor-tracking input with kill/delete ops, ANSI-aware text utils, stage animations, chunk tokenizer fixes, stream sanitization, logs viewer with search.

## Memory — One Brain, Every Surface

- **QOPC behavioral memory** — The agent detects skills and patterns from how you work. Shown live in terminal as it learns.
- **Cloud memory bridge** — Memories live in AetherCloud, keyed to you. Terminal, web, and desktop all read the same store. Inline memory chips in chat. Delete anything, anytime.
- **Shared skill learning** — Teach it once on any surface, it knows everywhere.

## Platform & Security

- **Security hardening across every surface** — Coordinated red-team sweeps: web, API, desktop client, server mesh. Token handling, billing, rate limiting, sandboxing.
- **Desktop red-team self-heal** — IPC jail escapes closed, chat XSS hardened, SSRF blocked, timer leak fixed.
- **New desktop installer** — Slint software-renderer wizard. No NSIS, no WebView2. Runtime provisioning (Node, Git, ripgrep) out of the box.
- **Agent orchestration API** — `/agents` management endpoints with lifecycle hooks and per-user context registry.
- **Faster chat turns** — Request-scoped user-context dedup cuts redundant DB reads.
- **MCP broker** — Flag-gated sub-app mount with OAuth providers catalog and JWT/aek_ token verification.
- **Live audit trail** — Now reports tool calls and UVT spend.

---

*AetherCloud & Aether Agent — June 9, 2026*
