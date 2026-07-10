# LOOP-19 · HANDOFF-PACKET — Seam-First Terminal Feel Patch

- **run-id:** 2026-07-10T03-28-15Z · **branch:** `loop/LOOP-19-2026-07-09` (base 9585ba9, 15 welds)
- **status:** IMPLEMENTED on the loop branch per operator directive ("don't stop, make this a meaningful patch"); NOT merged, NOT pushed. Merge is operator-only.
- **harness:** `npm test` — baseline 122/122 → final 168/168 (46 new assertions). Every weld committed green; one weld (E3) was amended once after a piped test run masked a compile failure (recorded honestly in AUDIT-ARTIFACT).

## Scope (what shipped, one weld per commit)

| weld | commit subject | element |
|------|---------------|---------|
| 1 | single version source, lockstep test | E4 |
| 2 | one kaomoji table | E5 |
| 3 | slash-command registry drives help + did-you-mean | E1 |
| 4 | splash advertises only real commands | E2 |
| 5 | stderr-keyed errTheme; dim reasoning; red fatal ✗ | E3 |
| 6 | /effort dial: slider UI, CODEPRO banner, AetherCloud-linked | E16 (operator steer) |
| 7 | [ FAIL ] goes red; HostRenderer first test | E7 |
| 8 | one success/failure vocabulary (auth/login) | E6 |
| 9 | actionable error hints under every failed turn | E12 |
| 10 | typo guard: lone near-miss tokens ≠ paid calls | E13 |
| 11 | real readline: persisted history, tab-completion, owned prompt | E9 |
| 12 | Ctrl+C cancels the turn, not the session | E10 |
| 13 | thinking pulse kills the dead air | E11 |
| 14 | end-of-run verdict line for aether code | E14 |
| 15 | COMMANDS.md tells the whole truth | E8 |

## Non-goals (do not silently reintroduce)

1. **NO alt-screen TUI** (rejected R1): the arena killed TuiLayout-v2/REPL-rewire/`--tui` for architectural conflict with scrollback-as-copy-paste-artifact + orphan precedent + wcwidth-under-C5. Any future attempt must follow R1's reopen conditions and build order.
2. **NO byte-identical pre-seams** (rejected R2): don't land `Surface`/Renderer hooks without a consumer.
3. **NO wire/protocol changes**: brain_protocol.ts, stream.ts frame vocabulary, envelope.ts, CONTRACTS.md untouched (verified in the audit). /effort rides the EXISTING TaskCommand.effort field only.
4. **NO retry/backoff, markdown rendering, /mcp implementation** (R5) — each is its own future loop.
5. **NO new dependencies** — everything is raw ANSI + node builtins.
6. **Swarm gate untouched** (C7).

## Acceptance criteria (all verified; re-verify on review)

- `npm test` 168/168 green on the branch tip.
- Non-TTY/piped output carries zero ANSI on: `--help`, typo-guard stderr, a full piped REPL session including /effort.
- `aether auht` → did-you-mean + `aether chat auht` escape + exit 2; multi-word prompts unaffected.
- REPL: up-arrow recalls prior-session prompts; Tab completes `/mo` → /models,/model; `/modle` → did-you-mean; Ctrl+C mid-turn cancels + reprompts, idle Ctrl+C exits 130 with goodbye.
- `/effort` renders the dial; `/effort codepro` renders the banner + persists; `aether code` without `--effort` sends the saved tier.
- `aether code` (non---json) always ends with the ✓/✗/— verdict line, including under `--no-log`.
- Thinking pulse: visible on TTY between submit and first frame; zero bytes when piped/--json/AETHER_NO_ANIM=1.

## Provenance summary

Full table: node-7-provenance-table.md (15/15 elements trace to accepted arena entries). Spine = IDEA-3 (interaction mechanics), armor = IDEA-1 (honesty/consistency riders), salvage = IDEA-2 (abort-first sequencing MUT-2.1, stall honesty MUT-3.2). Losing strengths preserved: node-7-rejected-register.md (R1–R7). E16 (/effort) is an operator-steered addition satisfying R5's reopen condition via the existing TaskCommand.effort field.

## Known residuals (honest)

- E15 (paste burst-batching) NOT shipped → register R6. A multi-line paste at an idle prompt still fires one turn per line (they queue sequentially; mid-turn pastes queue safely).
- Typo guard residual false positives at d=1 on real words used as one-word prompts (`runs`, `chart`, `mode`) — escape hatch printed every time; severable by reverting weld 10.
- theme/errTheme snapshot TTY-ness at import; injected-Writable renderers (web bridge) inherit process-stream keying (pre-existing pattern, unchanged).
- Windows conhost / real-pty behavior of terminal-mode readline verified only structurally + piped smoke; recommend one interactive smoke on Windows Terminal before merge (op checklist below).

## Operator checklist before merge

1. Read AUDIT-ARTIFACT.md (adversarial verdict + full trail).
2. Interactive smoke on your terminal: `aether` → up-arrow, Tab, /effort codepro, Ctrl+C mid-answer, Ctrl+C at prompt.
3. `npm test` locally.
4. Merge `loop/LOOP-19-2026-07-09` (or cherry-pick; every weld is severable).
