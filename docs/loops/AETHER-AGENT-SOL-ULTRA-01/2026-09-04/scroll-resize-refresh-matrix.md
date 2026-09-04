# Scroll, Resize, and Refresh Matrix

| Scenario | Deterministic result | Production boundary |
|---|---|---|
| 20x5, 40x12, 80x24, 120x40, 200x60 | PASS for capability/settings/TUI renderers | real terminals unproven |
| Append while scrolled / long-line reflow | PASS; content remains reachable | Markdown/live stream integration unproven |
| Resize while scrolled | PASS; logical entry/cell anchor retained | browser font metrics unproven |
| Hostile/oversized status metrics | PASS; finite nonnegative clamps | upstream live corruption unproven |
| Colored header, controls, ANSI width | PASS | exhaustive Unicode/fonts unproven |
| Resize burst | PASS; coalesced repaint | OS event cadence unproven |
| 100 mount/dispose cycles | PASS; zero listener growth | `TuiLayout` has no production caller |
| Supported active remount | PASS; atomic replay once, gap refusal, deadline retained | synthetic replayable source |
| Legacy active remount | fails closed unless explicit gap-detect fallback | live legacy embed unproven |
| Browser/Electron refresh | UNPROVEN | requires host harness |
| Live REPL type-ahead | composer preservation regression exists | PTY interaction not run |

Pager results are not generalized to the live chat REPL. Repository search found no production `new TuiLayout(...)` caller.
