# scource.md — aether-agent source of truth

Dev's table of contents for this repo. Generated during the 2026-07-01 cleanup
pass (branch `chore/repo-cleanup-audit`). Cross-references `cleaningnotes.md`
for what was actually changed. Update this file when structure, canonical
terms, or shared-constant ownership shifts — it's meant to stay current, not
be a one-time snapshot.

## 1. Repo map

```
src/
  main.ts            CLI entry — flag parsing, AppContext build, dispatch to cmdX handlers
  index.ts             Public library entry (@aether/cli) — re-exports client/stream/UI-embed surface
  types.ts             Shared config/catalog wire types (AetherConfig, CatalogItem, ...)
  version.ts           VERSION constant

  core/    (48 files, ~6.7k lines)  — business logic, network clients, protocol, no terminal I/O
  ui/      (33 files, ~3.6k lines)  — terminal rendering: ANSI, layout, input, pickers
  commands/ (28 files, ~4.7k lines after split) — CLI/REPL command handlers, one file per command surface

test/      (66 files) — node:test, mirrors src/ by concern (not 1:1 by file)
docs/      — plans/ releases/ reviews/ security/ specs/ (dated design docs, historical)
assets/    — REMOVED 2026-07-01 (was orphaned, see cleaningnotes.md #1)
```

### commands/ — slash-command group ownership (post-split)

`slash.ts` was 1807 lines (repo convention caps files at ~800). Split into a
thin dispatcher + 7 concern files. `handleSlash`'s switch statement stays
physically in `slash.ts` — `test/slash_registry.test.ts` parses its raw
source text (4-space-indented `case "x":` lines) to verify registry↔switch
sync, so that switch must never move.

| File | Owns | Depends on |
|---|---|---|
| `slash.ts` | dispatcher switch, catalog cache (`_catalog`/`getCatalog`/`primeCatalog`/`byKind`/`resolveSelection`), session handlers (`doctor`, `showPicker`, `select`, `showTier`, `showAudit`, `printHelp`), **plus 3 handlers left inline (not split out — small, single-use):** `/mcp` (dynamic-imports `./mcp.js`), `/logs`/`/logs-view` (calls `ui/logs_viewer.ts`), and a 12-case passthrough block (`/queue /steer /btw /plan /review /recon` etc. — one-line "handled in the REPL" stubs) | all 7 files below |
| `slash_context.ts` | `/pin /drop /snapshot /limit /token-budget /audit-receipt /purge` | `core/context_registry.ts`, `core/custody.ts`, `core/audit.ts` |
| `slash_git_tools.ts` | `/rollback /revert /stage-diff` | `core/stage_diff.ts`, raw `git` via `execSync` |
| `slash_codegen.ts` | `/scaffold /port /test-drive /bench` | `core/scaffold.ts`, `core/port.ts`, `core/test_drive.ts`, `core/bench.ts` |
| `slash_hud.ts` | `/add /hud` | `core/hud.ts`, `core/context_registry.ts` |
| `slash_vault_workflow.ts` | `/vault-* /workflow*` | `core/vault.ts`, `core/workflow.ts` |
| `slash_orchestra.ts` | `/agents /delegate /tree /broadcast /gather` | `core/orchestrator.ts` |
| `slash_media.ts` | `/photogen /frame /re-frame /videogen /sequence /animate /re-cut /output /storyboard` | `core/vision.ts` |

Other `commands/` files unchanged: `audit.ts`, `auth.ts`, `chat.ts` (725 lines
— second largest in repo, candidate for a future split, see §4), `code.ts`,
`config.ts`, `github.ts`, `goals.ts`, `login.ts`, `mcp.ts`, `media.ts`,
`models.ts`, `output.ts`, `prompt_modes.ts`, `receipt.ts`, `resume.ts`,
`run.ts`, `slash_registry.ts`, `vault.ts`, `workflow.ts`.

## 2. Canonical terms (things that mean one thing, use consistently)

- **UVT** — Unified Value Token, the metering unit for the model fleet. Used
  everywhere (`bench.ts`, `port.ts`, `scaffold.ts`, `context_registry.ts`,
  `transport.ts`, `render.ts`, `hud.ts`) but never spelled out in any single
  source file — this doc is now the canonical definition.
- **custody log** (client-held, `core/custody.ts`,
  `~/.config/aether/custody.jsonl`) vs **audit trail** (server-side,
  `core/audit.ts:fetchTrail`) vs **audit receipt** (`/audit-receipt`, merges
  both). See `commands/audit.ts` header comment for the authoritative
  explanation — promoted here so it survives file moves.
- **backend** — overloaded. `core/backend.ts`'s `BackendPref`/`BackendPath`
  mean "local vs cloud brain routing." Comments elsewhere ("push to the
  AETHER-CLOUD backend") mean "the server side of the API" generically. Two
  senses, same word — read context.
- **stage** vs **phase** — `stage` (ui/animations.ts, ui/phase_verb.ts) means
  agent *activity* (recon/reasoning/execute/self-review/…). `phase`
  (ui/goal_chain.ts `GoalPhase`, ui/workflow_viewer.ts `PhaseEntry`)
  means workflow/goal *phase* (numbered, agent-grouping). Not interchangeable.
- **workspace** vs **worktree** — near-homophones, different meanings.
  `core/workspace.ts` = the file-edit sandbox abstraction (`WorkspaceContext`,
  `applyEdit`). `core/worktree.ts` = literal `git worktree` isolation.
- **orchestrator** vs **agent** (3 senses) — *orchestrator* = a Neo/Kronus
  catalog entry (`CatalogItem.kind === "orchestrator"`). *agent session* = a
  live running worker (what `/agents` lists, from `GET /agents`). *`/agent`*
  = the slash command that picks an orchestrator. `models.ts:cmdAgents` shows
  the static orchestrator catalog; `slash_orchestra.ts:agentsSlash` shows
  live running sessions — same English word, unrelated data sources.
- **~/.aether-agent/** (sessions, history, snapshots, repo mirrors,
  worktrees) vs **~/.config/aether/** (config, token, mcp.json, custody log,
  goals) — two separate per-user data roots, never reconciled into one "my
  Aether CLI data" directory. Know which one a given file lives under before
  changing path logic.
- **"neo-lite"** — proper-noun personality name (`ui/host_render.ts`), not
  self-explanatory from the code alone.

## 3. Fixed in this pass (2026-07-01) — see cleaningnotes.md for detail

- Dead weight removed: `docs/index.html` (1.4MB unused bundler placeholder),
  `web-cloud.png`, `assets/` (6 files, all orphaned).
- Dead code removed: `notYet()` (duplicated, zero callers, `vault.ts` +
  `workflow.ts`), `_lastMediaPrompt` (write-only module state, `slash.ts`).
- Dead imports removed: `filterMediaModels`, `ASPECT_RATIOS`,
  `IMAGE_SHORTCUTS`, `VIDEO_SHORTCUTS`, `createTimer`, `titledBox`,
  `goalHelp`, `HudElementId` (all imported, never used, in old `slash.ts`);
  plus (found by the adversarial reviewer via `tsc --noUnusedLocals`)
  `mediaKind`/`listOutput`/`findOutput`/`clearOutput` in `media.ts`,
  `TemplateInfo`/`WorkflowAssessResponse` in `commands/workflow.ts`, and
  `VaultSpacesFile` in `core/workflow.ts`.
- Duplication consolidated: `fail()`/`errMsg()` error-formatter (5 near-
  identical copies across `media.ts`, `output.ts`, `vault.ts`, `workflow.ts`,
  `github.ts`) → `core/errors.ts` exports `errorMessage()` + `fail()`.
- God-file split: `commands/slash.ts` 1807 → 522 lines + 7 new focused files
  (table in §1). No file in the split exceeds ~300 lines.

## 4. Backlog — found, not fixed this pass (real follow-up work)

Not touched because: lower value-to-risk ratio than the items above, or the
fix is itself a nontrivial refactor that deserves its own reviewed PR rather
than being bundled into a mechanical cleanup pass. Grouped by file/area so a
future pass can grab one and go.

**Duplication (cross-file, medium risk to unify):**
- `hashOf` (`commands/audit.ts:69`) and `hashShortCustody`
  (`commands/slash_context.ts`) are near-identical but not byte-identical
  (different null/empty-string fallback, `hashOf` checks 4 fields,
  `hashShortCustody` checks 3). Audit/custody-adjacent — unify only with
  test coverage proving output is unchanged for both callers.
- Poll-until-deadline loop duplicated 3x: `github.ts:pollUntilConnected`,
  `mcp.ts:McpClient.pollUntilConnected`, `core/device.ts:pollForToken`.
  `PollOpts { intervalSec, timeoutSec }` type also duplicated verbatim in
  `github.ts` + `mcp.ts`.
- 4 independent progress/fill-bar implementations in `ui/`: `progress.ts`
  (canonical), `ui/statusbar.ts` inline, `ui/status_renderer.ts:bar()`,
  `ui/tui_layout.ts:bar()`.
- "Pad string to visible width" reimplemented in ≥5 `ui/` files despite
  `ui/text.ts` claiming sole ownership of width math.
- ANSI alt-screen/cursor escape codes (`\x1b[?1049h` etc.) hand-defined
  independently in `ui/model_picker.ts`, `ui/tui_layout.ts`,
  `ui/status_renderer.ts`, `ui/logs_viewer.ts` — `ui/restore.ts` claims to be
  the "central terminal-restore registry" but doesn't own these constants.
- Kaomoji/stage-glyph vocabulary duplicated across 4 maps with overlapping
  keys: `ui/kaomoji.ts`, `ui/phase_verb.ts`, `ui/statusbar.ts`,
  `ui/host_render.ts`.
- JSON-file-read-with-fallback pattern (`try { JSON.parse(readFileSync) }
  catch { default }`) reimplemented independently 6+ times across
  `core/config.ts`, `core/goals.ts`, `core/mcp_store.ts`,
  `core/context_registry.ts`, `core/session_resume.ts`, `core/vision.ts`.

**More dead imports (found via `tsc --noUnusedLocals` during the adversarial
review pass) — fixed since the files were already open in this diff:**
`commands/media.ts` (`mediaKind`, `listOutput`, `findOutput`, `clearOutput`),
`commands/workflow.ts` (`TemplateInfo`, `WorkflowAssessResponse` types),
`core/workflow.ts` (`VaultSpacesFile` type). See cleaningnotes.md §6.

**Still backlog:**
- Repo-wide: dozens of unused `ctx: AppContext` parameters on handler
  functions that don't need it (`tsc --noUnusedLocals --noUnusedParameters`
  surfaces them all) — this is a consistent enough pattern across the
  codebase that it reads as an intentional "handlers share one signature
  shape" convention rather than accidental dead params; worth a deliberate
  decision (enable `noUnusedParameters` + fix, or leave as house style)
  rather than a silent mass-edit.

**Magic numbers/strings (low risk, high volume — batch as its own PR):**
- Timeouts: no shared constant across `ollama.ts`, `web.ts`,
  `stage_diff.ts`, `test_drive.ts`, `tool_executor.ts`, `agent_events.ts`.
- "Keep last N records" caps: `HISTORY_CAP=1000`, custody `MAX=500`,
  vision output `>100` — three unrelated magic numbers for the same
  "capped append log" concept.
- `~/.aether-agent` root path constructed independently in 5 files instead
  of one shared helper (contrast `core/config.ts`'s `configDir()`, which
  does this correctly).
- Model-key literals (`"vision_gpt_image2"`, `"vision_seedance"`) repeated
  7x across the old `slash.ts` (now split across `slash_media.ts`) instead
  of named constants in `core/vision.ts`.

**Oversized files (candidates for a future split, same pattern as §1):**
- `commands/chat.ts` (725 lines) — `repl()` alone is ~455 lines mixing raw-
  mode lifecycle, paste state machine, Ctrl-C handling, slash dispatch, and
  HUD repaint. Candidate: extract the REPL engine to `ui/repl.ts`.
- `core/vision.ts` (428 lines) — model routing + prompt building + download
  engine + output log + storyboard parser in one file.
- `core/workflow.ts` (418 lines) — ~165 lines are inline literal template
  *data* (8 hardcoded workflow graphs) that belongs in a data file, not
  logic code.
- `ui/tui_layout.ts` (363 lines) — `TuiLayout` class is a god-object
  (terminal lifecycle + pager state + 4 render methods + resize handling).
- `commands/code.ts:cmdCode()` (200 lines, lines 106-304) — 6+
  responsibilities in one function; the animated/plain render branches
  duplicate structure.

**Misplaced logic (presentation code sitting in core/, or vice versa):**
- `core/hud.ts` and `core/render.ts` import from `src/ui/` and contain ANSI
  rendering — arguably belong in `ui/`, not `core/`.
- `commands/goals.ts:decomposeGoal` (pure heuristic, zero I/O) belongs in
  `core/goals.ts` alongside the rest of the goal model.
- `commands/auth.ts:renderAuthBox`/`renderLoggedOut` (~100 lines of ASCII-art
  box rendering) belongs in `ui/`.
- `ui/logs_viewer.ts:loadAllSessions`/`exportSession` do filesystem
  read/write — data-access logic sitting in a `ui/` file.

## 5. Number/constant relations worth knowing before touching them

- `TOKENS_PER_GB = 233_000_000` (`ui/statusbar.ts`) — named, exported, but
  the number itself is undocumented anywhere. Don't "simplify" it without
  understanding where 233M comes from.
- `CTRL_C_WINDOW_MS = 1500` (`commands/chat.ts`) and `heartbeatTimeoutMs:
  5000` (`commands/code.ts`) are the *only* named UX-timing constants in
  `commands/` — everything else in the backlog above is a bare literal.
- Box widths are inconsistent per-file: `BOX_W = 64` (`auth.ts`), `BOX = 74`
  (`slash.ts`), inline `{ width: 60 }` (`slash_context.ts`) — three
  unrelated hardcoded panel widths, no shared layout constant exists yet.
