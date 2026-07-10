# Aether AI — June 2026 Release Notes

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
