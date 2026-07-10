# Workflow Viewer → Agent Panel — Design

**Date:** 2026-07-10
**Repo:** aether-code (shared-backend companion: `AETHER-CLOUD` — see [companion spec](#companion-spec))
**Scope:** `src/ui/workflow_viewer.ts`, `src/ui/task_chain.ts`, `src/commands/chat.ts` (the live in-REPL popout), `src/core/brain_protocol.ts` (shared wire protocol, additive only)
**Status:** SPEC ONLY — no code in this document.

## Origin

This is the terminal-CLI half of a cross-repo investigation. The operator asked to mirror Claude Code's own "Background tasks" panel — agents, tool-calls, tokens, elapsed time, grouped by phase — inside the product's task-chain UI, then clarified that aether-code and `AETHER-CLOUD` **share a backend**, that "the task chain" specifically means the live agent workflow triggered at CODEPRO/HIGH+ effort tiers (not the separate JSON workflow-template builder), and that the existing UI's fixed small cardinality (three, on the `AETHER-CLOUD` side) needs to generalize. The full findings — including the shared wire protocol, the backend's actual metrics availability, and the primary design — live in the [companion spec](#companion-spec) in `AETHER-CLOUD`. This document covers what's specific to aether-code: what exists here today, its own independent bugs, and how it should consume the same wire extension once it lands.

## Current State — Verified Findings

### A. No sidebar exists; the closest thing is an in-REPL popout

`aether-code` has no persistent side-panel concept. `src/ui/tui_layout.ts` (`TuiLayout`) implements a full alt-screen, fixed-region layout (HEADER/TRANSCRIPT/STATUS/INPUT, absolute ANSI positioning) that *could* host a sidebar column, but it is **not the live default REPL surface** — `docs/specs/2026-06-09-frontend-ux-overhaul-design.md:47` explicitly rejected unifying the chat REPL onto `TuiLayout` ("changes the default chat UX wholesale, kills native scrollback in the REPL... belongs behind a flag later"). `TuiLayout` is exercised only by `test/tui.test.ts` today — zero production call sites (`grep "new TuiLayout("` returns test files only). `src/commands/chat.ts` runs its own inline, natural-scrollback REPL instead.

The actual live analog to "task chain popout" is `src/ui/workflow_viewer.ts`'s `WorkflowViewerState` + `renderCiTree()`, wired into `chat.ts`:
- State: `viewerState`/`viewerOpen` (`chat.ts:378-379`).
- Frame ingestion: `chat.ts:409-433`.
- Toggle: Down-arrow opens it once a workflow becomes visible (`chat.ts:717-722`); Up/Down move a cursor through agents while open (`chat.ts:706-716,723-727`); Escape closes it (`chat.ts:742-748`).
- Render: `renderCiTree()` (`workflow_viewer.ts:102-115`) — a flat list, `▶ ●  agent-id  brief`, no phase grouping, no metrics columns.

### B. A real, demonstrable redraw bug in the existing popout

Every arrow-key move while the viewer is open does `\r\x1b[2K` (clear **one** line) then `write(renderCiTree(...) + "\n")` (`chat.ts:709-711,720-722,725-727`). This only erases the input row — not the previously-printed tree — so each cursor move leaves another full copy of the (growing) tree stacked in scrollback. This is a defect independent of the metrics/phase-grouping work below, and needs fixing regardless (pin-and-redraw-in-place, tracking the last-rendered line count and walking back up over it before repainting, the same idiom multi-line CLI progress UIs use).

### C. `WorkflowViewerState` silently drops phase information

`applyViewerFrame()`'s switch (`workflow_viewer.ts:34-84`) handles `workflow_start`, `agent_spawn`, `agent_progress`, `agent_done`, `workflow_done` — **it has no case for `phase_start` or `phase_done`**; both fall to `default: return state`. The live popout today has no phase names, no phase completion status, and no way to group agents by phase, even though the wire already carries this (`brain_protocol.ts:23-33`, `PhaseStartFrame`/`PhaseDoneFrame`).

`src/ui/task_chain.ts`'s `TaskChainState`/`applyFrame` model phases correctly (`n`, `type`, `agentCount`, `status`, `artifactSummary`) — but it is **unused in production**. `grep "createTaskChainState|applyFrame("` finds call sites only in `test/task_chain.test.ts` and `test/brain_cloud_workflow.test.ts`; nothing in `src/commands/*.ts` ever constructs or updates it. It appears to be a superseded prototype for exactly the shape `WorkflowViewerState` needs but never absorbed.

**Proposal:** consolidate — extend `WorkflowViewerState` to also handle `phase_start`/`phase_done` (reusing `task_chain.ts`'s already-correct transition logic), then delete `task_chain.ts` as dead code, migrating its test cases into `workflow_viewer.test.ts` so the phase-transition behavior it already verifies isn't lost.

### D. `selectAgent`/`renderAgentFeed` are built but never wired

`workflow_viewer.ts` exports `selectAgent()` and `renderAgentFeed()` (drill into one agent's raw streamed output) — both are exercised only in `workflow_viewer.test.ts`. `chat.ts`'s key handler has no "select/enter" case that calls either; Enter always submits the input buffer as a chat turn. A "view one agent's live feed" capability is fully built and completely unreachable from the running app.

### E. Data gaps — identical shape to the `AETHER-CLOUD` side

`WorkflowViewerState.AgentEntry` (`workflow_viewer.ts:3-10`) tracks `id, phaseN, brief, status, feed, summary` — no tokens, no tool-call count, no duration. The wire has nowhere to carry them either: `AgentSpawnFrame`/`AgentProgressFrame`/`AgentDoneFrame` (`brain_protocol.ts:34-50`) carry only `agentId`/`phaseN`/`brief`/`delta`/`summary`. This is the same three-tier gap the companion spec documents on the backend side (duration cheap, tool-calls moderate, tokens hardest) — see that document's Finding G for the concrete backend-side plan; this repo's job is decoding whatever additive fields land there.

Session-level (not per-agent) tokens already exist and render today: `telemetry` frame (`tokens, tps, ctxUsed, ctxCap, vram`, `brain_protocol.ts:74`), surfaced via `StatusRenderer`/`TuiLayout`'s UVT figure (`status_renderer.ts:231-234`, `tui_layout.ts:271-272`).

One divergence from the shared backend worth flagging: `brain_protocol.ts`'s `BrainEvent` union includes an `AgentProgressFrame` (`agentId, delta`) that the companion spec's backend investigation found **no emitter for** in `lib/orchestrator` (`phase_scheduler.py` emits only `agent_spawn`/`agent_done`, never a streaming delta). This field may be aspirational, or emitted only by aether-code's separate local-Ollama brain path — not confirmed either way; flagged here so it isn't assumed to be live wire traffic from the shared backend.

### F. Achievable today with zero protocol changes

Not everything in the reference panel needs a backend change:
- **Per-agent elapsed time** — the client can stamp `Date.now()` on `agent_spawn` and tick it live, the same technique `StatusRenderer`/`TuiLayout` already use for the session-level elapsed figure. No wire change needed.
- **Workflow description line** — `chat.ts` already has the triggering prompt text in hand (`built.prompt`, `chat.ts:402/409`) at the moment it starts a turn; it doesn't need the brain to echo it back.
- **Aggregate token/agent-count header fields** — `WorkflowStartFrame.totalAgents` and the session `telemetry.tokens` figure already exist and are already rendered elsewhere.
- **Phase grouping and per-phase dot-status** — unblocked entirely by Finding C's consolidation (task_chain.ts's logic already does this correctly); no wire change needed.

Only the per-agent **Tokens** and **Tools** columns are genuinely gated on the backend extension.

### G. Reusable primitives already in this codebase

- `src/ui/theme.ts` / `errTheme` — `createTheme()` pattern, ANSI wrappers (`bold`, `cyan`, `iceBlue`, `dim`, `muted`, `green`, `red`, `yellow`).
- `src/ui/box.ts`'s `titledBox()` (`box.ts:111-149`) — an existing bordered-panel-with-header drawer, exactly the outer card shape needed; no need to hand-roll box-drawing the way `src/ui/goal_chain.ts` does.
- `src/ui/text.ts` — `visibleWidth`/`sliceVisible`/`wrapVisible`, the mandatory ANSI-safe width substrate for any new multi-line renderer.
- `src/ui/statusbar.ts`'s `humanTokens()` (`statusbar.ts:33-38`) — K/M/B formatting, matches the reference screenshot's "97.6k"/"1.8M" style exactly.
- `src/ui/elapsed.ts`'s `formatElapsed()` — matches the reference's "4m 26s"/"58m 28s" format exactly.
- `src/ui/effort.ts`'s block-track slider (`▓`/`●`/`░`) — a style precedent for progress/status indicators.
- `src/core/hud.ts` — an existing, extensible, width-aware, slash-command-toggled (`/add`, `/hud list/remove/clear`) element registry. Good UX/discoverability precedent, **wrong shape for this work**: HUD elements are single horizontal lines composed side-by-side, not stacked multi-row panels — don't force the phase/agent table into this system.
- **Minor cleanup opportunity, not required for this work:** three independent progress-bar implementations exist (`tui_layout.ts:338-341`, `status_renderer.ts:240-244`, `src/ui/progress.ts`), using two different glyph conventions (`▓/░` vs `█/#`). Worth consolidating if touching this area anyway; not blocking.

## Approaches Considered

**A. (chosen) Upgrade the existing inline popout in place.** Fix the redraw bug (Finding B), consolidate phase-handling (Finding C), extend `AgentEntry` with client-derivable fields first (Finding F), then wire Tier-2/3 metrics once the backend extension lands (Finding E). Keeps the existing Down-to-open/Up-Down-navigate/Escape-to-close muscle memory. Smallest blast radius, matches this repo's own demonstrated preference for surgical, additive hardening over wholesale rewrites (`docs/specs/2026-06-09-frontend-ux-overhaul-design.md`'s own "Approach A" chose exactly this posture over a bigger unification).

**B. Adopt `TuiLayout` as the live REPL surface and add a true persistent sidebar column.** The visually truest match to the reference screenshot (a real always-on side panel, not a toggle) — but this is precisely the step `docs/specs/2026-06-09-frontend-ux-overhaul-design.md:47` already considered and explicitly deferred ("belongs behind a flag later"). Not rejected outright; documented here as the future path once Approach A has shipped and proven the data model, gated behind a flag so it doesn't force the larger decision now.

**C. A separate full-screen "drill-down" view for one agent's feed, reusing the `logs_viewer.ts`/`model_picker.ts` full-takeover pattern.** Folded into Approach A as a stretch task (wire up the already-built `selectAgent`/`renderAgentFeed` from Finding D) rather than kept as a separate top-level approach — it complements the popout, it doesn't replace it.

## Design (approach A)

### Mockup

```
┌─ WORKFLOW ──────────────────────────────────────────────────────────┐
│  merge-reconcile-harden                              58m 28s        │
│  19 agents · 1.8M tokens                                            │
│                                                                      │
│  Reconcile 31-file merge conflict between loop/LOOP-19 patch and    │
│  a much-more-mature origin/main, then harden + simplify + add CI    │
│                                                                      │
│  PHASES                                                             │
│  ▾ Resolve round 1 (leaf clusters)        ●●●●●●  done              │
│      resolve:B     97.6k tok    40 tools    4m 26s                  │
│      resolve:C     72.1k tok    31 tools    2m 32s                  │
│      resolve:D     87.0k tok    50 tools    3m 58s                  │
│      resolve:E    178.2k tok   104 tools   10m 18s                  │
│      resolve:F     71.6k tok    29 tools    2m 11s                  │
│      resolve:G     74.4k tok    37 tools    2m 21s                  │
│  ▸ Harden (breaker/builder)               ●●●●●●●●○○   running      │
│                                                                      │
│  [↑↓ move · →/Enter expand phase · ←/Esc collapse · q close]        │
└──────────────────────────────────────────────────────────────────────┘
```

Built with `titledBox()` for the outer frame, width `min(78, cols-2)` (matching `logs_viewer.ts`'s established narrow-terminal convention), `humanTokens()`/`formatElapsed()` for formatting, `theme.ts` for coloring. Tokens/Tools columns render `—` until Tier-2/3 wire data arrives for that agent — never a fabricated number, consistent with the companion spec's error-handling stance.

### State changes

- Consolidate `task_chain.ts`'s phase-tracking into `WorkflowViewerState` (Finding C): add `phases: PhaseRailEntry[]`-shaped tracking, handle `phase_start`/`phase_done`.
- Extend `AgentEntry` with client-derivable fields (Finding F): `startedMs: number | null`, plus the backend-gated `tokens`/`toolCalls`/`durationMs: number | null` once Tier 1-3 land.
- Add `expandedPhaseNs: number[]` to `WorkflowViewerState` for the collapse/expand interaction (plain array, not a `Set`, to keep the existing immutable-spread reducer style and strict-equality test assertions working unchanged).

### Redraw fix

Track the line count of the last panel render; before repainting, emit that many `\x1b[1A\x1b[2K` (cursor-up + clear-line) sequences instead of today's single `\r\x1b[2K`. Needs its own test (`tui.test.ts`-style: assert repeated moves never grow the emitted output beyond one panel's worth of lines).

### Protocol extension (mirrors the companion spec's backend Tiers, TS-side)

Per `docs/CONTRACTS.md`'s own versioning rule — *"Additive, forward-compatible changes do NOT bump the [PROTOCOL_VERSION] integer... a new message type, or a new OPTIONAL field on an existing message, that old (v1) consumers safely IGNORE"* — this repo can decode the same additive fields the companion spec proposes without a version bump, once the shared backend actually emits them:

- Extend `AgentDoneFrame` (`brain_protocol.ts:45-50`) with optional `tokens?`, `toolCalls?`, `durationMs?` (wire: `tokens`, `tool_calls`, `duration_ms`), defaulted via the existing `num(obj[...], 0)` pattern already used throughout `decodeEvent()` so a brain that doesn't send them yet never throws.
- **Pre-existing documentation drift, unrelated to this proposal but touching the same table:** `docs/CONTRACTS.md:11` still declares `PROTOCOL_VERSION = 2` and its message tables (lines 47-70) list none of the `workflow_start`/`phase_start`/`agent_spawn`/etc. frames at all, even though `brain_protocol.ts:14` has been at `PROTOCOL_VERSION = 3` with these frames implemented for some time. By this doc's own rule ("if code and this doc disagree, this doc wins and the code is the bug"), this is already out of compliance independent of anything proposed here. Worth closing in the same change that touches this table next, so the drift doesn't widen further.

## Error Handling

- Non-TTY / `AETHER_NO_TUI=1` paths unaffected — the popout is TTY-gated the same way the rest of `chat.ts`'s interactive UI is.
- Missing Tier 2/3 data renders `—`, never estimates or zero-as-if-real.
- `AgentProgressFrame`'s unconfirmed emitter status (Finding E) means the panel should not assume streaming deltas arrive reliably — `renderAgentFeed`'s drill-down (Finding D stretch task) should handle an empty/sparse feed gracefully.

## Testing

- Extend `test/workflow_viewer.test.ts`, `test/tui.test.ts`.
- Migrate `test/task_chain.test.ts`'s phase-transition cases into `workflow_viewer.test.ts` before deleting `task_chain.ts` (Finding C).
- New: redraw-fix regression test (line-count-bounded repaint), phase-expand/collapse test, decode-side test for the new optional `AgentDoneFrame` fields (present and absent).

## Out of Scope

- Adopting `TuiLayout` as the default REPL surface (Approach B — future work, flagged, not decided here).
- Any change to `src/commands/workflow.ts` / `src/core/workflow.ts` (the JSON workflow-template builder — vault-stored `.aetherflow.json`, `WORKFLOW_TEMPLATES`) — confirmed architecturally separate from the live agent-workflow concept this spec addresses; do not conflate the two.
- Backend instrumentation itself (Tiers 1-3) — owned by the companion spec / `AETHER-CLOUD` repo.
- The three-duplicate-progress-bar cleanup (Finding G) — noted, not required.

---

## Companion Spec

`AETHER-CLOUD/docs/superpowers/specs/2026-07-10-task-chain-agent-panel-design.md` — the primary investigation (this is the secondary, terminal-CLI-specific half), covering the shared backend's actual metrics availability (tiered), the desktop task-chain UI's own "3 orbs" defect and its likely-wrong backend wiring, and the JSON-workflow-vs-agent-workflow disambiguation in full. `AETHER-CLOUD/docs/adr/ADR-0001-task-chain-agent-cardinality.md` records the core architectural decision both repos' agent-cardinality models should converge on.
