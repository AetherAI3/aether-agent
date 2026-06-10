# Terminal Frontend/UX Sweep — Findings & Plan (2026-06-10)

Full-surface review of the aether-agent terminal (REPL, input, rendering, slash
commands, interactive surfaces, streaming, lifecycle). Four parallel recon
passes over `src/ui/*`, `src/commands/*`, and the stream/lifecycle core, each
finding verified against source before inclusion. Base: `feat/frontend-ux-overhaul`
(PR #22) which already fixed pager reflow, chat-bar cursor math, ANSI-injection
sanitizing, and animation wiring — those are NOT re-listed here.

## Verified findings

### P0 — broken behavior a user can hit today

| # | Where | Problem |
|---|-------|---------|
| 1 | `chat.ts:288` | **Ctrl+C always hard-exits the whole REPL** — with a half-typed draft, or mid-turn. One reflexive Ctrl+C (terminal copy habit) kills the session and any queued work. No abort path for a hung/slow turn short of killing the session. |
| 2 | `transport.ts:113` | `stream()` has **no AbortController and no timeout** — a stalled SSE connection hangs the turn forever; the only escape is finding #1. |
| 3 | `input_render.ts` + `chat.ts` paste path | **Multi-line paste corrupts the composer row**: pasted `\n` chars are kept verbatim in the buffer and written raw during repaint, so each repaint emits real linefeeds — stacked garbage rows. |
| 4 | `gradient.ts:29-41,64-78` | Gradient iterates **UTF-16 code units**: surrogate-pair emoji are split into two lone surrogates separated by SGR sequences → mojibake; interpolation position also miscounts for wide chars. |
| 5 | `main.ts:242-247` | Crash path (uncaught exception/rejection) prints and exits with **no terminal restore** — raw mode, bracketed paste, hidden cursor, mouse mode, alt-screen all leak to the parent shell. |

### P1 — negative UX

| # | Where | Problem |
|---|-------|---------|
| 6 | `input_line.ts` | History is **session-only** (lost on exit), no consecutive-duplicate suppression, and recalling history **discards the in-progress draft** permanently. |
| 7 | `keys.ts` | No word-jump (Ctrl/Alt+←→), no Tab (dead key), no Ctrl+L. Editing long prompts means arrow-key crawling. |
| 8 | `slash.ts:846` (printHelp) | **11 implemented commands missing from /help**: photogen, frame, re-frame, videogen, sequence, animate, re-cut, output, storyboard, logs, mcp. Help text is hand-maintained → permanent drift. |
| 9 | `slash.ts:110` | Unknown command → no "did you mean"; no `/help <command>` detail view; no Tab completion (combined with #7). |
| 10 | `render.ts:65` | Chat answers render as **raw text** — literal `**bold**`, `## headers`, un-tinted code fences. The flagship surface looks flat. |
| 11 | `model_picker.ts:194` | Picker clears the real screen with `2J` instead of using the alt-screen → **prior scrollback context is wiped** after picking. |
| 12 | `chat.ts` turn start | **No liveness indicator between submit and first streamed byte** — slow routing reads as a dead terminal. |
| 13 | `render.ts:118` / `chat.ts:431` | Errors print raw (`✗ HTTP 401`) with **no recovery hint** (login / rate-limit wait / server-down guidance). |
| 14 | `session_log.ts:73` | `appendFileSync` **per stream event** — synchronous disk I/O serialized into the render hot path. |
| 15 | `status_renderer.ts:225` | Process listeners installed per instance, never removed; SIGINT write unguarded (fix exists on `fix/status-renderer-cleanup`, cherry-picked here). |
| 16 | `input_line.ts:18` | `insert()` splices per character → O(n²) on large pastes; noticeable freeze ≥ tens of KB. |
| 17 | `logs_viewer.ts:189` | Raw-mode restore is conditional, not `finally`-guaranteed — a throw mid-viewer leaks raw mode. |

### P2 — polish / consistency

| # | Where | Problem |
|---|-------|---------|
| 18 | `heartbeat.ts:29` | `beat()` restarts the envelope mid-pulse → visible stutter under rapid events. |
| 19 | `gradient.ts:41` | Per-char `\x1b[0m` reset doubles escape bytes (~20× payload on big banners). |
| 20 | `input_line.ts:47` | `deleteWord()` only respects spaces — `/path/to/file` deletes wholesale. (Accepted: matches bash ctrl-w; documented.) |
| 21 | `splash.ts` | Static splash; no rotating tip — discoverability of power features (/steer, /queue, Tab) is zero. |

### Claims from recon REJECTED on verification

- `PARTIAL_ESC_RE` lastIndex bug — regex is not `/g`; no state. Sound.
- `statusbar.ts` >100% — fraction is clamped. Sound.
- `input_render.ts` cursor-by-codepoint — it already measures display width. Sound.
- `sliceVisible` splitting wide chars — it breaks before overflow. Sound.
- StatusRenderer `stop()` missing clearInterval — `end()` clears it. Sound (listener stacking was the real issue, see #15).

## Plan (one PR, stacked on #22)

Workstreams, in execution order; every item lands with unit tests:

1. **Lifecycle safety net** — new `src/ui/restore.ts` central terminal-restore
   registry hooked to uncaughtException/unhandledRejection/exit; REPL, pickers,
   viewers register their restore steps. Cherry-pick `c15fc55`. Picker → alt-screen.
   Logs viewer → try/finally. (#5, #11, #15, #17)
2. **Turn control** — `stream(path, body, signal?)`; runTurn takes AbortSignal;
   REPL Ctrl+C state machine: mid-turn → abort turn (session lives), draft →
   clear line, idle → press-again-to-exit hint. Ctrl+D unchanged. (#1, #2)
3. **Input feel** — persistent history (`~/.aether-agent/history`, cap 1000,
   consecutive-dupe suppressed, draft preserved on recall); word-jump keys;
   Tab completion for slash commands; Ctrl+L; O(n) bulk insert; `⏎` glyph
   rendering for embedded newlines. (#3, #6, #7, #16)
4. **Slash registry** — single `COMMANDS` table (name/usage/summary/section)
   drives printHelp, `/help <cmd>`, Tab completion, and unknown-command
   suggestions (edit distance ≤ 2). Kills help drift structurally. (#8, #9)
5. **Stream beauty** — minimal stateful markdown styler for delta text
   (headers, bold, inline code, fence tinting; line-buffered, TTY+color only,
   raw passthrough otherwise); pre-first-byte "thinking" pulse line; friendly
   error mapper (401/403/429/timeout/network → action hint). (#10, #12, #13)
6. **Perf + polish** — batched session-log writes (flush ≤50 events / 100 ms /
   close); gradient code-point iteration + single trailing reset; heartbeat
   no-restart-mid-pulse; splash rotating tip line. (#4, #14, #18, #19, #21)

Out of scope (deliberate): `/mcp` (PR #21 owns it), `deleteWord` semantics
(#20, bash parity), tui_layout mouse default (needs desktop-embed coordination),
quote-aware slash parser (only consumers parse their own args today).
