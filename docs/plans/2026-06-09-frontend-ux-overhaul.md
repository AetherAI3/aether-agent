# Frontend UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the aether-agent terminal frontend resize-proof, input-robust, and injection-safe: reflowing pager, consistent chat bar with a real cursor, live (not dead) stage animations, sanitized stream output, fixed truecolor escapes — plus doc/file reorganization.

**Architecture:** One new shared module (`src/ui/text.ts`) owns all width/slice/wrap/sanitize math; key decoding moves to `src/ui/keys.ts` with a chunk tokenizer; every renderer (REPL repaint, TuiLayout, StatusRenderer, Renderer, goal_chain, logs_viewer, box) consumes the shared utilities instead of private ad-hoc versions. No protocol or backend change; non-TTY/JSON output stays byte-identical.

**Tech Stack:** TypeScript (ESM, strict), `node --test`, zero runtime deps.

**Spec:** `docs/specs/2026-06-09-frontend-ux-overhaul-design.md`

---

### Task 1: `src/ui/text.ts` — width / slice / wrap / sanitize

**Files:**
- Create: `src/ui/text.ts`
- Test: `test/text.test.ts`

- [ ] **Step 1: Write failing tests** (`test/text.test.ts`) covering: `stripAnsi` removes SGR + OSC-8 + CSI cursor moves; `visibleWidth` counts CJK/emoji as 2, combining as 0, SGR as 0; `sliceVisible` truncates colored strings without splitting escapes and reset-terminates; `wrapVisible` wraps a styled line into rows ≤ cols and re-opens SGR state on continuation rows; `sanitizeTerm` strips OSC/CSI/DCS/lone-ESC + C0 (except `\n`,`\t`) and drops `\r`.
- [ ] **Step 2: Run** `npm test` — new file FAILS (module not found).
- [ ] **Step 3: Implement `src/ui/text.ts`:**

```ts
// src/ui/text.ts — shared terminal-text utilities: ANSI-aware width math,
// truncation, wrapping, and sanitation of stream-sourced text. Every renderer
// uses THESE; no module keeps a private stripAnsi/width copy.

const ANSI_RE =
  // CSI … final byte | OSC … BEL/ST | DCS/SOS/PM/APC … ST | 2-char escapes
  /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]/g;

/** Strip ALL ANSI escape sequences (SGR, CSI, OSC incl. hyperlinks, DCS…). */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Visible column width of one code point (wcwidth-lite). */
export function charWidth(cp: number): number {
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) return 0;
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||
      (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x1f000 && cp <= 0x1f2ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) return 2;
  return 1;
}

/** Visible column width of a styled string (ANSI = 0 columns). */
export function visibleWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charWidth(ch.codePointAt(0)!);
  return w;
}

/** Truncate to `max` visible columns, preserving escapes; reset-terminated. */
export function sliceVisible(s: string, max: number): string { /* walk: copy ANSI_RE matches verbatim; count widths via charWidth; stop when next char would exceed max; append \x1b[0m if any ESC was emitted */ }

/** Wrap a styled logical line into rows of ≤ cols visible columns, carrying
 *  open SGR state onto continuation rows. "" -> [""]. */
export function wrapVisible(s: string, cols: number): string[] { /* track active SGR seqs (cleared on \x1b[0m or \x1b[m); emit rows; prefix continuation rows with the active seqs */ }

/** Sanitize stream-sourced text for terminal output: strip all escape
 *  sequences and C0 controls except \n and \t (\r dropped). */
export function sanitizeTerm(s: string): string {
  return s.replace(ANSI_RE, "").replace(/\x1b/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}
```

- [ ] **Step 4:** `npm test` — text tests PASS, 220 legacy stay green.
- [ ] **Step 5:** Re-export from `theme.ts` (`export { stripAnsi } from "./text.js"`, delete local copy) and from `box.ts` (replace `plainLen` with `visibleWidth`). Run tests.
- [ ] **Step 6: Commit** `feat(ui): shared text utils — ANSI-aware width/slice/wrap + terminal sanitizer`

### Task 2: `src/ui/keys.ts` — key decode + chunk tokenizer

**Files:**
- Create: `src/ui/keys.ts`
- Modify: `src/commands/chat.ts` (re-export shim), `src/ui/model_picker.ts:12` (import flip)
- Test: `test/keys.test.ts`

- [ ] **Step 1: Failing tests:** `splitKeys("abc")` → one text token; `splitKeys("a\x1b[Db")` → 3 tokens; `splitKeys("héllo🎉")` → one token (no drops); paste islands `\x1b[200~…\x1b[201~` survive; `decodeKey("\x1b[3~")` → delete; `\x01`/`\x05`/`\x0b`/`\x15` → home/end/kill-end/kill-start; multi-char text token decodes to `{kind:"char", value:"abc"}`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement:** move `Key`+`decodeKey` from chat.ts verbatim, then: add kinds `delete | kill-end | kill-start`; default branch accepts multi-char non-ESC printable runs as `char`. Add:

```ts
/** Tokenize a raw stdin chunk into complete key sequences. Batched keystrokes,
 *  UTF-8 text runs, and ESC sequences are never silently merged or dropped. */
export function splitKeys(chunk: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i]!;
    if (ch === "\x1b") {
      const rest = chunk.slice(i);
      const m = rest.match(/^\x1b\[[0-9;]*[A-Za-z~]/) ?? rest.match(/^\x1bO[A-Z]/);
      if (m) { out.push(m[0]); i += m[0].length; continue; }
      out.push("\x1b"); i++; continue;
    }
    if (ch < " " || ch === "\x7f") { out.push(ch); i++; continue; }
    let j = i;
    while (j < chunk.length && chunk[j]! >= " " && chunk[j] !== "\x7f" && chunk[j] !== "\x1b") j++;
    out.push(chunk.slice(i, j)); i = j;
  }
  return out;
}
```

chat.ts keeps `export { decodeKey, type Key } from "../ui/keys.js"` so existing imports/tests stay valid. model_picker imports from `../ui/keys.js` (kills the ui→commands inversion).
- [ ] **Step 4:** `npm test` PASS (incl. existing chat_keys.test.ts).
- [ ] **Step 5: Commit** `feat(ui): keys module — chunk tokenizer fixes dropped batched/multibyte input`

### Task 3: InputBuffer edit ops + shared input-line view

**Files:**
- Modify: `src/ui/input_line.ts` (add `deleteForward/killToEnd/killToStart`)
- Create: `src/ui/input_render.ts`
- Test: `test/input_line.test.ts` (extend), `test/input_render.test.ts`

- [ ] **Step 1: Failing tests:** buffer ops (`deleteForward` removes char at cursor; `killToEnd` truncates from cursor; `killToStart` removes before cursor and zeroes it); `renderInputView(prompt,value,cursor,cols)` keeps cursor inside the row for long input (window slides), returns `cursorCol` = prompt width + cursor offset within window + 1; wide chars position correctly.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement:**

```ts
// src/ui/input_render.ts — single-row input view with a horizontal scroll
// window around the cursor. Pure; both the REPL repaint and TuiLayout use it.
import { charWidth, visibleWidth } from "./text.js";

export interface InputView { text: string; cursorCol: number } // col is 1-based

export function renderInputView(prompt: string, value: string, cursor: number, cols: number): InputView {
  const pw = visibleWidth(prompt);
  const avail = Math.max(1, cols - pw - 1); // one spare col for the cursor
  const cps = [...value];
  const w = (i: number): number => charWidth(cps[i]!.codePointAt(0)!);
  const widthBetween = (a: number, b: number): number => { let t = 0; for (let i = a; i < b; i++) t += w(i); return t; };
  let start = 0;
  while (widthBetween(start, cursor) > avail - 1) start++;
  let end = start, used = 0;
  while (end < cps.length && used + w(end) <= avail) { used += w(end); end++; }
  return { text: prompt + cps.slice(start, end).join(""), cursorCol: pw + widthBetween(start, cursor) + 1 };
}
```

InputBuffer additions:

```ts
deleteForward(): void {
  if (this.cursor < this.chars.length) this.chars.splice(this.cursor, 1);
}
killToEnd(): void {
  this.chars.splice(this.cursor);
}
killToStart(): void {
  this.chars.splice(0, this.cursor);
  this.cursor = 0;
}
```

- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(ui): input view with cursor-tracking horizontal window + kill/delete ops`

### Task 4: Chat REPL — real cursor, no dropped keys, resize-safe

**Files:**
- Modify: `src/commands/chat.ts` (repaint, onData loop)
- Test: `test/chat.test.ts` (extend pure parts)

- [ ] **Step 1:** Failing test for new exported `repaintString(prompt, value, cursor, cols)`: returns `\r\x1b[2K` + windowed text + `\x1b[<col>G`.
- [ ] **Step 2:** FAIL. **Step 3: Implement:**

```ts
import { renderInputView } from "../ui/input_render.js";
import { splitKeys, decodeKey } from "../ui/keys.js";

export function repaintString(prompt: string, value: string, cursor: number, cols: number): string {
  const v = renderInputView(prompt, value, cursor, cols);
  return "\r\x1b[2K" + v.text + `\x1b[${v.cursorCol}G`;
}
```

In `repl()`: `repaint = () => process.stdout.write(repaintString(prompt, buf.value, buf.pos, process.stdout.columns ?? 80))`. The onData handler loops `for (const seq of splitKeys(chunk.toString("utf8")))` feeding the existing per-sequence logic (paste accumulation handled inside the loop, same states as today). Add `delete`→`buf.deleteForward()`, `kill-end`→`killToEnd`, `kill-start`→`killToStart`. Add `const onResize = (): void => { if (!busy) repaint(); }; process.stdout.on("resize", onResize)`; `cleanup()` removes it.
- [ ] **Step 4:** PASS. **Step 5: Commit** `fix(chat): cursor-correct repaint, tokenized input (no dropped keys), resize repaint`

### Task 5: Prompt-mode table extraction

**Files:**
- Create: `src/commands/prompt_modes.ts`
- Modify: `src/commands/chat.ts:299-438` (replace the 9 if-blocks)
- Test: `test/prompt_modes.test.ts`

- [ ] **Step 1:** Failing tests: `applyPromptMode("/recon auth flow")` → `{handled:true, prompt:"RECONNAISSANCE MODE…auth flow…", notice:'🔎 Recon: "auth flow"'}`; `/recon` with no arg → `{handled:true, error:"usage: /recon <topic>"}`; plain text → `{handled:false}`.
- [ ] **Step 2:** FAIL. **Step 3:** Table `{cmd, takesArg, usage, notice(arg), build(arg)}` carrying the EXACT current strings (copied verbatim from chat.ts so the rewritten prompts are byte-identical); `applyPromptMode(t)` returns `{handled, prompt?, notice?, error?}`. chat.ts submit handler replaces the if-chain with one call (busy-guard behavior preserved: handled modes are blocked when busy with the same "Agent is busy — use /queue" message).
- [ ] **Step 4:** PASS + legacy chat tests green. **Step 5: Commit** `refactor(chat): table-driven prompt modes`

### Task 6: TuiLayout — reflowing pager + clamped status + shared input

**Files:**
- Modify: `src/ui/tui_layout.ts`
- Test: `test/tui.test.ts` (extend)

- [ ] **Step 1:** Failing tests: after `log()` of a 250-col line with `cols=80`, `visibleWindow()` yields 4 wrapped rows; shrinking cols (set private cols via resize simulation) re-wraps so all content remains reachable by scrolling; the status write is ≤ cols visible; `unmount()` removes the resize listener (listenerCount returns to baseline).
- [ ] **Step 2:** FAIL. **Step 3:** Implement a wrapped-row cache:

```ts
private wrapCache: string[] = [];
private wrapCols = 0;
private rows_(): string[] {
  if (this.wrapCols !== this.cols) {
    this.wrapCache = this.transcript.flatMap((l) => wrapVisible(l, this.cols));
    this.wrapCols = this.cols;
  }
  return this.wrapCache;
}
```

`log()` appends `wrapVisible(line, this.cols)` rows to a valid cache (bumping `offset`/`unseen` by rows-added when scrolled up). `maxOffset` + `visibleWindow()` operate on `rows_()`. `onResize()` invalidates (`this.wrapCols = -1`) then clamps offset. `renderStatus()` writes `sliceVisible(line, this.cols)`. `renderInput()` uses `renderInputView` and places the cursor at `at(inputRow, view.cursorCol)`. Resize handler stored as `private readonly onResizeBound = (): void => this.onResize()`; `mount()` attaches, `unmount()` detaches.
- [ ] **Step 4:** PASS. **Step 5: Commit** `fix(tui): reflowing pager on resize, clamped status row, cursor-aware input, listener cleanup`

### Task 7: StatusRenderer — live stage art + width clamp

**Files:**
- Modify: `src/ui/status_renderer.ts`, `src/commands/code.ts:203-205`
- Test: `test/status_renderer.test.ts`, `test/code_wiring.test.ts` (extend)

- [ ] **Step 1:** Failing tests: `setAnim("▰▰▱▱")` shows the art in `composeLine()`; `composeLine()` never exceeds `sink.columns - 1` visible cols on a 40-col StringSink; wiring test asserts AnimationController frames reach `setAnim`.
- [ ] **Step 2:** FAIL. **Step 3:** Add `private anim = ""` + `setAnim(art: string): void { this.anim = art; this.repaint(); }`; compose: `${hb}  ${this.anim ? this.theme.cyan(this.anim) + "  " : ""}${head}…`; final `return sliceVisible(line, Math.max(20, this.sink.columns - 1))`. Delete the `setStage` no-op; `code.ts` wires `onFrame: (_stage, art) => sr.setAnim(art)`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(ui): wire stage animations into the live status line; clamp to width`

### Task 8: Renderer sanitation + usage-stomp fix

**Files:**
- Modify: `src/core/render.ts`
- Test: `test/render_sanitize.test.ts` (new)

- [ ] **Step 1:** Failing tests: a `delta` containing `\x1b]0;evil\x07` writes with the OSC stripped; `reasoning`/`error.msg`/`progress.text`/task labels likewise; interim `usage` frame writes nothing in text mode; `done` summary unchanged; `{json:true}` passes frames verbatim.
- [ ] **Step 2:** FAIL. **Step 3:** Wrap every stream-sourced string (`f.text`, `f.msg`, `f.label`, `f.delta`, custody order-id slice) in `sanitizeTerm(...)`; delete the `case "usage"` interim `\r⟢` write and the `task_progress` `\r⟢` write (the `done` frame already reports final UVT/cents — interim carriage returns were stomping streamed stdout lines).
- [ ] **Step 4:** PASS. **Step 5: Commit** `fix(render): sanitize stream-sourced text (ANSI/OSC injection); stop usage \r stomping streamed lines`

### Task 9: goal_chain truecolor repair

**Files:**
- Modify: `src/ui/goal_chain.ts:8-16,31-33`
- Test: `test/goal_chain.test.ts` (new)

- [ ] **Step 1:** Failing test: rendered chain contains `\x1b[38;2;26;166;183m`; `stripAnsi(render)` does NOT contain `;2;26;166;183m`; all 6 rows of a phase box have equal visible width.
- [ ] **Step 2:** FAIL. **Step 3:**

```ts
const fg = (r: number, g: number, b: number) => (s: string): string => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
const cyan = fg(26, 166, 183);
const iceBlue = fg(135, 215, 255);
const green = fg(0, 200, 100);
const yellow = fg(220, 200, 50);
const red = fg(220, 60, 60);
const muted = (s: string): string => `\x1b[38;5;240m${s}\x1b[0m`;
const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
```

`pad()` switches to `visibleWidth` from text.ts (drop the local `stripAnsi` import).
- [ ] **Step 4:** PASS. **Step 5: Commit** `fix(ui): goal chain emitted broken truecolor escapes (raw ;2;r;g;bm text on screen)`

### Task 10: logs_viewer — live search, width, resize, teardown

**Files:**
- Modify: `src/ui/logs_viewer.ts`
- Test: `test/logs_viewer.test.ts` (new)

- [ ] **Step 1:** Failing tests on a new exported pure reducer `viewerReduce(state, key)`: `/` enters search mode; printable chars build the query; Enter applies; Esc cancels; `q` quits only when not in search mode; Enter no longer triggers export.
- [ ] **Step 2:** FAIL. **Step 3:** Implement the reducer (state: `{mode:"list"|"search", query, sessionIdx, scrollOffset, action?:"quit"|"export"|"exportAll"}`), wire `onData` through `splitKeys` + the reducer; footer shows `search: ${query}▌` in search mode; `titledBox(..., { width: Math.min(82, (process.stdout.columns ?? 84) - 2) })`; add `process.stdout.on("resize", render)` removed in cleanup; cleanup adds `if (!wasRaw) stdin.pause()`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `fix(ui): logs viewer — working / search, narrow-terminal width, resize redraw, stdin teardown`

### Task 11: model_picker + gradient polish

**Files:**
- Modify: `src/ui/model_picker.ts`, `src/ui/gradient.ts:66-76`
- Test: `test/model_picker.test.ts`, `test/gradient.test.ts` (extend)

- [ ] **Step 1:** Failing tests: gradientBlock leaves spaces uncolored (parity with gradientLine); picker rerender output ends with `\x1b[0J` (stale rows cleared when the list shrinks).
- [ ] **Step 2:** FAIL. **Step 3:** gradientBlock skips `" "` exactly like gradientLine; picker `rerender` writes `"\x1b[H" + renderPicker(...) + "\n\x1b[0J"`; confirm the keys import flip from Task 2.
- [ ] **Step 4:** PASS. **Step 5: Commit** `fix(ui): picker stale-row clear; gradient skips spaces`

### Task 12: Repo organization

**Files:**
- Move (git mv): `.hermes/plans/*.md` → `docs/plans/`; `docs/superpowers/plans/*` → `docs/plans/`; `docs/superpowers/specs/*` → `docs/specs/`; `release/*` → `docs/releases/`
- Modify: `.gitignore` (+ `.hermes/`), any markdown references

- [ ] **Step 1:** `git mv` batches; `rg -l "docs/superpowers|release/|\.hermes" -t md` and fix links.
- [ ] **Step 2:** `npm test` still green (no src refs to moved docs).
- [ ] **Step 3: Commit** `chore: group plans/specs/releases under docs/; ignore .hermes runtime dir`

### Task 13: Full verification

- [ ] `npm test` — all suites green (target ≥ 250 tests, zero fail).
- [ ] `npm run build` — clean tsc.
- [ ] Manual smoke (real TTY): REPL — fast typing, arrow-left mid-line edit, multi-line paste, narrow the window mid-stream, confirm chat bar intact; `/models` picker; Ctrl-C restores terminal.
- [ ] Self-review workflow over the full diff; fix CRITICAL/HIGH.
