# LOOP-19 · Node 8 — Coherence Check (Frankenstein guard)

Question: do the accepted grafts still fit together once combined? Conflicts found and resolutions:

1. **E9 × E10 (terminal-mode readline × Ctrl+C semantics).** With `terminal: true`, readline enables raw mode: Ctrl+C stops raising process SIGINT and is synthesized as the interface's `'SIGINT'` event instead. CONFLICT with any plan that pauses readline during turns (a paused interface stops processing input → mid-turn Ctrl+C would go dark). RESOLUTION: never pause the interface; handle `rl.on('SIGINT')` (terminal mode) AND `process.once('SIGINT')` (non-terminal fallback); lines typed mid-turn queue and process sequentially (today's for-await shape already does this). The AT-3b "pause during turn" mitigation floated in round 1 is REJECTED here as incoherent with E10 — echo-redraw-mid-stream is accepted as the pre-existing cooked-echo analog.
2. **E1 import graph.** splash (ui/) must not import slash.ts (commands/, which pulls transport/auth). RESOLUTION: registry lives in its own zero-import module; slash.ts, chat.ts (completer), splash consumers all import the pure data module. No cycle, no network pull into ui/.
3. **E13 × E1 (shared fuzzy-match).** One Damerau-Levenshtein helper in the registry module serves both slash did-you-mean and the top-level typo guard. No duplicate implementations.
4. **E3 ordering.** errTheme must land before E7/E10/E11/E12 (they style stderr). Weld order enforces this.
5. **E5 byte-identity.** statusbar PHASES faces verified string-identical to KAOMOJI values (anchoring→logging, scanning→scanning, reasoning→active, grounding→error, paging→idle) — mapping asserted in the weld's test so a wrong mapping cannot slip through.
6. **E10 unknown surfaces.** transport.ts and run.ts were NOT read during generation (flagged in candidate confidence blocks). GATE: read both before welding E10; if ApiClient.stream cannot accept a signal cleanly, E10 degrades to REPL-level cancellation (drain-and-discard) and says so in the commit body.
7. **E14 dual render paths.** Summary must be produced in BOTH the animated and plain onEvent closures (shared Set + composer in code_support), suppressed under --json on the print site only (the frames already carry the data for machines).
8. **E11 × E10 dependency.** The stall line's "Ctrl+C cancels the turn" copy is truthful ONLY after E10 lands. Weld order puts E10 before E11. If E10 is dropped by the operator, E11's stall copy must drop the Ctrl+C claim (noted in both commit bodies).
9. **E2 × tests.** ui.test.ts pins the four splash status lines; the honesty weld updates the pinned expectations in the SAME commit (C3-compatible: one commit, green).

No unresolved incompatible grafts. VERDICT: coherent — proceed to node 9 (implementation + packaging). Resynthesis cycles used: 0 of 2.
