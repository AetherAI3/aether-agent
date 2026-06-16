# Frontend UX Overhaul — Design

**Date:** 2026-06-09
**Repo:** aether-agent
**Branch:** `feat/frontend-ux-overhaul`
**Scope:** terminal frontend (src/ui, chat REPL, render pipeline), security hardening of rendered output, repo filesystem organization.

## Goals

1. **Chat bar consistency** — the composer stays correct under cursor movement, fast typing, paste, long input, and terminal resize.
2. **Pager resilience** — cropping/resizing the terminal window reflows the transcript instead of truncating or corrupting it.
3. **Animations / ASCII / states / heartbeat render effectively** — no dead wiring, no ghost lines, no raw escape garbage, clean error states.
4. **Security** — model/server-controlled text is sanitized before it reaches the terminal (ANSI/OSC injection).
5. **Repo organization** — plan/spec/release docs grouped under `docs/`; runtime artifact dirs ignored.

## Confirmed defects (first-hand recon, file:line)

### CRITICAL
- `src/ui/goal_chain.ts:10-16` — every truecolor helper builds `\x1b[38m` + literal `;2;R;G;Bm` text (the `m` in `esc(38)` terminates the sequence early). `/goals` prints raw `;2;26;166;183m` garbage on screen, and `stripAnsi`-based padding math is wrong for every box. Same bug in `muted` (`;5;240m`).
- `src/core/render.ts:61-63` — model `delta` / `reasoning` / error text is written raw to the terminal. A malicious or buggy server payload can emit OSC/CSI sequences (title/clipboard rewrite, screen clear, hidden text). All stream-sourced text must pass a terminal sanitizer.
- `src/commands/chat.ts:118-156,199` — `decodeKey` only matches single-key chunks. Batched keystrokes (fast typing, SSH latency, non-bracketed paste) and multi-byte graphemes (emoji, CJK) arrive as one chunk, match nothing, and are **silently dropped**. Needs a chunk tokenizer that splits a chunk into key sequences and feeds each through `decodeKey`.

### HIGH
- `src/commands/chat.ts:170-172` — `repaint()` writes prompt+buffer with no cursor positioning: after `left`/`home` the visible cursor sits at end-of-line, so mid-line editing looks broken. When `prompt+input` exceeds terminal width the line wraps and `\r\x1b[2K` clears only the last row → ghost rows. Fix: single-row input renderer with a horizontal scroll window around the cursor + explicit cursor column placement.
- `src/ui/tui_layout.ts:231-236,293-296` — transcript lines longer than the window are **truncated** (`fit`), so narrowing the window hides content permanently. Fix: store logical lines, wrap to current `cols` at render time (reflow on every resize), with scroll/offset math operating on wrapped display rows.
- `src/ui/tui_layout.ts:247,293-294` — the status row calls `fit(line, true)` which returns the string unchanged; an overflowing status line wraps into the input row and corrupts the layout. Clamp with the ANSI-aware slicer.
- `src/commands/code.ts:203-205` + `src/ui/status_renderer.ts:126` — `AnimationController` frames are wired to `StatusRenderer.setStage`, a documented no-op. The whole stage-animation system (deep_strike/radar/buffer/sentry/kernel_panic) runs timers and renders **nothing**. Wire the art into the status line.
- `src/ui/status_renderer.ts:191-207` — `composeLine()` has no width clamp; on a narrow terminal the pinned line wraps and `\r\x1b[2K` cannot clear the wrapped row → ghost lines accumulate. Clamp to `sink.columns - 1`.

### MEDIUM
- `src/core/render.ts:64-66,79` — interim `usage` frames write `\r⟢ …` to stderr while deltas stream to stdout on the same terminal → the carriage return stomps the current streamed line. Replace with a line-safe summary at `done` (which already prints UVT/cents).
- `src/ui/logs_viewer.ts:131-134` — `/` "search" sets `searchQuery = ""` and there is no input mode: search is dead UI. `\r` (Enter) surprise-exports ALL sessions. Box width fixed at 82 → overflows narrow terminals; no resize redraw; cleanup never `stdin.pause()`s.
- `src/ui/theme.ts:39-42` — `stripAnsi` strips only SGR (`\x1b[...m`); OSC-8 hyperlinks and other CSI leak into width math (box.ts carries its own better version — consolidate).
- `src/ui/tui_layout.ts:110,300-324` — resize listener never removed on `unmount` (leak on remount); `sliceVisible` counts wide chars (CJK/emoji) as 1 column → mis-truncation.
- `src/ui/model_picker.ts:12` — `ui/` imports `decodeKey` from `commands/chat.ts`: layering inversion (commands→ui is the intended direction). Move key decoding into `src/ui/keys.ts`.
- `src/commands/chat.ts:299-438` — nine copy-pasted prompt-rewrite branches (`/recon`, `/plan`, `/research`, …) inline in the key handler; `repl()` is ~330 lines. Extract a declarative prompt-mode table to `src/commands/prompt_modes.ts`.

### LOW
- `src/ui/gradient.ts:66-76` — `gradientBlock` colors spaces (gradientLine skips them): cosmetic inconsistency + byte bloat.
- `src/commands/chat.ts` — no `delete` key (`\x1b[3~`), no ctrl-a/e/k/u.
- `src/ui/model_picker.ts:194,239` — full `\x1b[2J` clear wipes REPL scrollback; rerender without clear leaves stale rows when the list shrinks.

## Approaches considered

**A. Surgical hardening (chosen).** Add one shared text-measurement/sanitize module; fix each surface in place; wire the dead animation path; extract the input-line renderer so REPL and TuiLayout share it; reflow pager; repo doc moves. Smallest blast radius, every fix unit-testable, behavior preserved for non-TTY/JSON consumers.

**B. Unify chat REPL onto TuiLayout (alt-screen everywhere).** One render authority, Claude-Code feel in plain chat too. Rejected for this PR: changes the default chat UX wholesale, kills native scrollback in the REPL, large test surface — belongs behind a flag later.

**C. Minimal clamps only.** Width clamps + sanitizer, skip reflow/animation/logs-viewer. Rejected: fails the stated goal (crop window → transcript unaffected) and leaves the dead animation system in place.

## Design (approach A)

### 1. `src/ui/text.ts` — shared terminal-text utilities (new)
- `charWidth(cp)` / `visibleWidth(s)` — ANSI-aware; East-Asian-Wide + emoji = 2 cols, combining/zero-width = 0.
- `sliceVisible(s, max)` — truncate to visible columns preserving SGR; always reset-terminated (moved from tui_layout, wide-char aware).
- `wrapVisible(s, cols)` — wrap a styled logical line into display rows (carries SGR state across rows).
- `stripAnsi(s)` — full: SGR + CSI + OSC (BEL- and ST-terminated). `theme.ts`/`box.ts` re-export from here.
- `sanitizeTerm(s)` — for stream-sourced text: strip ESC-introduced sequences (CSI/OSC/DCS/APC/PM/SOS, lone ESC) and C0 controls except `\n`/`\t`. `\r` → dropped.

### 2. `src/ui/keys.ts` — key decoding (moved + extended)
- `decodeKey(seq)` moves here from `chat.ts` (re-export shim stays in chat.ts for compat).
- New `splitKeys(chunk)`: tokenizes a stdin chunk into complete key sequences (ESC-sequences, bracketed-paste islands, grapheme-safe UTF-8 text runs) so batched input is never dropped. `char` kind becomes a text run (`value` may be multi-char).
- Add `delete` (`\x1b[3~`), ctrl-a/e/k/u mappings.

### 3. Chat REPL (`chat.ts`)
- `repaint()` → shared `renderInputLine(sink, prompt, buf, cols)`: horizontal scroll window keeps the cursor visible on one row; explicit cursor column write; clamp to width.
- Key loop consumes `splitKeys()` output; paste path unchanged.
- `resize` listener → repaint (and detach on cleanup).
- Prompt-mode branches → table in `src/commands/prompt_modes.ts`; `repl()` shrinks below 200 lines.

### 4. TuiLayout pager reflow
- `transcript` stays logical lines; a derived wrapped-row view (cached per `cols`, invalidated on resize/append) feeds `visibleWindow()`/`maxOffset` — scroll position preserved proportionally on reflow; follow-at-bottom and "N new" semantics unchanged.
- Status row clamped via `sliceVisible`; input row uses the shared input renderer; `unmount()` removes the resize listener.

### 5. Status line + animations (one-shot agent)
- `StatusRenderer.setAnim(art)` (new) renders stage art between heartbeat and verb; `code.ts` wires `AnimationController.onFrame` → `setAnim`. `setStage` no-op deleted.
- `composeLine()` output clamped to `sink.columns - 1`.
- Error state: `kernel_panic` art + `Recovering` verb already map; ensure `end()` always clears the pinned line even after error (teardown ordering in code.ts is already correct — covered by test).

### 6. Renderer (chat stream) hardening
- `delta`/`reasoning`/`error.msg`/`progress.text`/task labels pass through `sanitizeTerm`.
- Interim `usage` `\r` ticker removed; `done` summary remains.

### 7. goal_chain truecolor fix
- Replace broken helpers with correct `\x1b[38;2;r;g;bm` (single sequence); width math via shared `visibleWidth`.

### 8. logs_viewer
- Real search input mode (`/` enters, chars accumulate, Enter applies, Esc cancels); remove Enter=export-all; box width `min(82, cols-2)`; redraw on resize; cleanup pauses stdin when it resumed it.

### 9. model_picker
- Import keys from `ui/keys.ts`; rerender clears with per-line erase instead of leaving stale rows (keep `\x1b[2J` only on entry/exit).

### 10. Repo organization (filesystem)
- `.hermes/plans/*.md` → `docs/plans/` (these are this repo's committed dev plans; `.hermes/` is the agent's *runtime* output dir in user repos) and add `.hermes/` to `.gitignore`.
- `docs/superpowers/plans/*` → `docs/plans/`; `docs/superpowers/specs/*` → `docs/specs/`; drop the empty `docs/superpowers/` tree.
- `release/*` → `docs/releases/`.
- All moves via `git mv`; grep + fix references. npm package unaffected (`files: [dist, README, COMMANDS, LICENSE, NOTICE]`).
- **Deferred (follow-up PR):** split `src/commands/slash.ts` (71 KB, ~55 handlers) into `src/commands/slash/{session,vault,workflow,media,orchestrator,models,misc}.ts` behind the existing `handleSlash` dispatch — mechanical but large; kept out to keep this PR reviewable.

## Error handling
- All new renderers are non-TTY safe: `text.ts` helpers are pure; render paths keep the existing `tty`/`AETHER_NO_TUI`/`AETHER_NO_ANIM`/`NO_COLOR` gates; non-TTY output stays byte-identical (guarded by existing tests).
- Sanitizer is fail-open on plain text (no escapes → identity) so `--json` and pipes are untouched (JSON mode bypasses sanitize entirely — frames pass verbatim).

## Testing
- `node --test` (existing 220 stay green).
- New unit tests: `text.test.ts` (width/slice/wrap/sanitize incl. wide chars + OSC), `keys.test.ts` (splitKeys batching, paste islands, UTF-8 runs), `input_render.test.ts` (cursor window math), `tui reflow` cases in `tui.test.ts` (narrow resize keeps content reachable, status row never exceeds cols), `goal_chain` escape-correctness test, `render sanitize` test, `status_renderer` clamp + setAnim test, `logs_viewer` search filter test (pure parts).

## Out of scope
- slash.ts module split (follow-up), REPL-on-TuiLayout unification, any backend/protocol change, npm publish.
