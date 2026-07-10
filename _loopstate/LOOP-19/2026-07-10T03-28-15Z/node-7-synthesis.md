# LOOP-19 · Node 7 — Synthesized Idea: "Seam-First Terminal Feel Patch"

Not "candidate 3 wins" — a constructed idea. Spine: IDEA-3's interaction mechanics (the only candidate that moves minute-one felt pain), re-armored by IDEA-1's honesty/consistency elements wherever they survived attack, carrying IDEA-2's two salvageable seams (abort-first sequencing, stall-honesty concept) while its alt-screen end-state goes to the register with reasons.

**Thesis:** Fix the interactive seams of the EXISTING scrollback-native terminal model — input recall, dead air, cancellation, actionable errors — and make every surface tell the truth from one source (command registry, honest splash/help/docs, verified-status hints, stderr-correct styling). Ship as ~14 independent ratchet welds, each `npm test`-green, each revertible alone.

## Elements (E#) with provenance → see node-7-provenance-table.md

**Wave A — truth & consistency (registry first, it feeds everything):**
- E1 Command registry: `SLASH_COMMANDS` as pure data (name/args/desc/aliases) in a new dependency-free module; `printHelp` derives from it (fixes the verified /quit-missing-from-help drift); did-you-mean (Damerau) for unknown slash commands; the registry is the completer source for E9.
- E2 Splash honesty: hint line derives from real commands; `/effort` becomes a plain effort label, not a fake command. Pinned ui.test.ts updated in the same weld.
- E3 errTheme: stderr-keyed styling variant in theme.ts; printError ✗ red via errTheme; reasoning stream dimmed via errTheme (I3.7 reinstated); host_render/render stderr writes this patch touches migrate to errTheme. Strictly improves C2 (fixes the pre-existing stdout-keyed-ANSI-on-stderr leak).
- E4 Version single source: main.ts imports version.ts; lockstep test vs package.json.
- E5 One kaomoji table: statusbar PHASES built from KAOMOJI (byte-identical, asserted).
- E6 Auth/login vocabulary: ✓/✗ + sentence case + actionable failure lines.
- E7 [ FAIL ] red + error ✗ red in host_render + first host_render test (content via stripAnsi).
- E8 COMMANDS.md truth: `aether code` section, /doctor + /mcp rows.

**Wave B — interaction mechanics (the spine):**
- E9 Real readline: full construction (output, prompt, terminal:isTTY, historySize, persisted history at config-dir/history honoring AETHER_CONFIG_DIR, completer from E1); rl.prompt() replaces 4 manual prompt writes; non-TTY bytes unchanged.
- E10 Turn cancellation: AbortSignal through ApiClient.stream AND the postJson fallback (closes AT-3d's hole); per-turn AbortController in the REPL; rl 'SIGINT' event (terminal mode) + process.once fallback (non-terminal); mid-turn → dim "✗ canceled" + reprompt, session survives; idle → `(⌨_⌨)  bye` exit 130 (I1.9 subsumed). `aether run` inherits cancelability via runTurn — intended, documented.
- E11 Thinking pulse + stall honesty: `(⌨_⌨) thinking···` on stderr from submit to first frame; ≥10s frameless → `still waiting — Ctrl+C cancels the turn`; zero bytes when non-TTY/--json/NO_ANIM.
- E12 Actionable error hints: pure `errorHint(err, baseUrl)` in errors.ts (401/403 → `aether auth login`; 429 → `/tier`; network causes → `/doctor` + baseUrl); consumed by chat printError + main.ts fatal catch.
- E13 Top-level typo guard (NARROWED per arena): fires only on exactly one bare positional token, Damerau ≤1 (len≤5) / ≤2 (len≥6) from a known subcommand → exit 2 with did-you-mean + real escape hatch `aether chat <word>` (argv-safe, unlike quoting). Severable.

**Wave C — run surface:**
- E14 End-of-run summary + unverified hint: pure `runSummary()`; `✓ ok · N files changed · tests green · 3m12s` / `✗ incomplete · N tests failing · …`; prints even with --no-log (today: nothing at all); surfaces the computed-then-buried failing count; `unverified` gains `— pass --test-cmd "<cmd>" to make the run prove itself`; suppressed under --json.

**Stretch (weld only if all core welds are green):**
- E15 Paste burst-batching in the REPL loop (queued-lines batch, pure decision fn) — answers AT-3a within readline's limits.

## Weld order (each = one commit, tests green before weld)

E4 → E5 → E1 → E2 → E3 → E7 → E6 → E12 → E13 → E9 → E10 → E11 → E14 → E8 (+E15 stretch)
Rationale: trivial warm-ups first; registry before its three consumers; errTheme before every stderr-styling weld; mechanics last-but-verified (largest blast radius, maximal test coverage already in place by then).
