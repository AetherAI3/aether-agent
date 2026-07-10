# LOOP-19 · Node 6 — Shared Arena Log (FREE-MAD, all candidates co-present)

Round budget: 3 (protocol max 4). Rounds run: 1 full advocate round + arbiter adjudication.
Closure rationale: premature-convergence guard satisfied structurally (every candidate ≥2 attacks received, ≥1 mutation drawn FROM it and ≥1 proposed BY it); no silent agreement (advocates disagreed sharply on I1.5, I3.7, and the alt-screen direction, all with cited evidence); remaining disagreements adjudicated below with rationale. LOOP-11 hostile gate still follows at node 9.

## Round 1 — attacks (arbiter verdict per attack)

### Against IDEA-1 (4 received)
| id | from | attack | arbiter verdict |
|----|------|--------|----------------|
| AT-1a | Adv-3 | 5+ of 12 commits invisible by design (version/kaomoji dedup, docs); after 9.75h the interaction pain (up-arrow, Ctrl+C, dead air) is untouched | **ACCEPT (partial)** — correct on prioritization; doesn't invalidate the elements as cheap adds. Consequence: IDEA-1 cannot be the spine; its elements ride along a mechanics-first plan. |
| AT-1b | Adv-3 + Adv-2 | I1.5 typo guard false-positives (`chart`→chat d1, `logs`→login d2, `mode`→code d1); **quoting is no escape hatch — argv loses quotes**, so `aether "logs"` is indistinguishable from `aether logs`; multi-token typos still sail through as paid calls | **ACCEPT** — the quoted-escape design flaw is fatal as specced. Element survives only in Adv-1's narrowed form: single bare token, Damerau ≤1 (len≤5) / ≤2 (len≥6), escape hatch `aether chat <word>` (a real subcommand), exit 2. |
| AT-1c | Adv-2 | Red-on-stderr styled by a stdout-keyed theme: ANSI sprayed into `2>err.log`, red vanishing under `\| tee`; CI can't assert any of it | **ACCEPT** — and promoted to a graft: introduce a stderr-keyed theme variant (`errTheme`) and migrate the stderr writes this patch touches. Fixes a pre-existing leak (host_render telemetry dim → stderr keyed off stdout). |
| AT-1d | Adv-2 | I1.9 makes dying prettier instead of preventing death; the in-flight paid turn is still discarded | **ACCEPT** — I1.9 merges into I3.3's dual hook (MUT-3.3): idle Ctrl+C → goodbye; mid-turn → cancel the turn, keep the session. |

### Against IDEA-2 (6 received)
| id | from | attack | arbiter verdict |
|----|------|--------|----------------|
| AT-2a | Adv-3 | Rebuilds the repo's own proven failure mode at 6.6-8.8× rival budgets — TuiLayout (309 lines, sole importer = its test) IS the git-history evidence; I2.1/I2.2 are dead code until I2.5 | **ACCEPT** |
| AT-2b | Adv-3 | Alt-screen contradicts the product's own architecture: status_renderer.ts:3-4 explicitly rejects alt-screen; diffs render into scrollback as designed copy-paste artifacts; Windows-first risk stack (conhost, no wcwidth under C5) | **ACCEPT** — decisive for direction. |
| AT-2c | Adv-1 | "ANSI-aware wrap" = hand-rolled wcwidth under C5 with C6's kaomoji as pathological input (combining marks, wide Hangul, RTL و, ambiguous ✧) in an absolute-positioned grid where one 1-column error corrupts every row below | **ACCEPT** |
| AT-2d | Adv-1 | I2.5 inherits a cleanup contract it must break (installCleanup hard-binds SIGINT→exit 130 vs "ctrl-c cancels turn"); no uncaughtException hook → raw-mode + alt-screen stranding | **ACCEPT** |
| AT-2e | Adv-1 | Value back-loaded behind risk: I2.4 defined byte-identical (zero visible value), I2.1/2 invisible until I2.5; payoff regresses copy-paste in a tool whose primary output is copied code | **ACCEPT** |
| AT-2f | Adv-1 | Uncosted stdin contention in I2.8: interact.ts spawns cooked readline per question on shared stdin; repo gate + stage gates must be resequenced around raw mode — absent from the estimate | **ACCEPT** |

### Against IDEA-3 (5 received)
| id | from | attack | arbiter verdict |
|----|------|--------|----------------|
| AT-3a | Adv-2 | Paste = N paid turns (10-line paste → up to 10 sequential API calls); readline cannot fix without raw mode | **ACCEPT (hazard)** — mitigation synthesized: burst-batching of queued lines (stretch element E15); full fix deferred with the alt-screen register entry. |
| AT-3b | Adv-2 + Adv-1 | Readline redraw / echo interleaving mid-stream; three uncoordinated writers (stdout deltas, stderr pulse, stderr reasoning) | **ACCEPT (bounded)** — pulse stops at first frame; reasoning/delta split pre-exists; keystroke echo pre-exists in cooked mode. Mitigation: SIGINT handled via rl event; queued-line processing stays sequential (today's shape). |
| AT-3c | Adv-2 | Completer needs a registry that doesn't exist; slash.ts help already drifts (**/quit works but is absent from printHelp — verified defect**) | **ACCEPT** — resolved by the registry graft (MUT-3.1/MUT-2.3). |
| AT-3d | Adv-1 | I3.3 scope hole: StreamUnavailableError fallback postJson is a second, uncancellable call; runTurn is shared with `aether run` (orchestrator Ctrl+C silently changes); 2 input modes × 3 turn states testability | **ACCEPT** — mitigations: thread the same signal into postJson; document the run.ts change as intended; pure isAbortError + targeted tests. |
| AT-3e | Adv-1 | I3.6 duplicates I1.7; I3.5 duplicates I1.4 | **ACCEPT** — consolidation instruction; provenance credits both sides. |

## Round 1 — mutations (arbiter verdict)

| id | proposer | graft | verdict |
|----|----------|-------|---------|
| MUT-1.1 | Adv-1 | I3.4 error hints onto IDEA-1 (pure err→hint mapper) | **ACCEPT** (core) |
| MUT-1.2 | Adv-1 | I2.4 surface seam as byte-identical 13th commit + golden test | **REJECT** — dead code until a consumer exists, by this arena's own standard (AT-2a/2e). → register R2. |
| MUT-2.1 | Adv-2 | Abort seam (I3.3) sequenced first as increment 0 | **ACCEPT** (core, shapes weld order) |
| MUT-2.2 | Adv-2 | I3.4 hints as pure formatter consumed by multiple surfaces | **ACCEPT** (merged with MUT-1.1) |
| MUT-2.3 | Adv-2 | SLASH_COMMANDS registry + did-you-mean feeding completion | **ACCEPT** (merged with MUT-3.1) |
| MUT-2.4 | Adv-2 | Epilogue graft: end-of-run summary + unverified hint + --no-log fix, TUI-independent | **ACCEPT** (core) |
| MUT-2.5 | Adv-2 | Persisted-history file format as storage layer | **ACCEPT** (trivially, = I3.1's history file) |
| MUT-3.1 | Adv-3 | One canonical SLASH_COMMANDS table drives /help + completer + did-you-mean + splash hint — ghost commands die structurally | **ACCEPT** (core; also fixes the /quit help drift found in AT-3c) |
| MUT-3.2 | Adv-3 | Stall watchdog on the thinking pulse: ~10s frameless → "still waiting — Ctrl+C cancels the turn" (I2.6's honesty concept, no raw mode) | **ACCEPT** (core) |
| MUT-3.3 | Adv-3 | I1.9 subsumed into I3.3 dual hook: idle Ctrl+C → kaomoji goodbye exit 130; mid-turn → cancel turn | **ACCEPT** (core) |

## Round 1 — concessions (arbiter ruling)

| advocate | concession | ruling |
|----------|-----------|--------|
| Adv-1 | I1.5 weakest; keep narrowed (single bare token, d≤1 short / ≤2 long, `aether chat <word>` escape) | **ACCEPT narrowed form** (see AT-1b). |
| Adv-2 | Drop I2.9 (/resume); redirect hours into width math | I2.9 → register R3. Width-math investment moot (alt-screen rejected); notes preserved in R1. |
| Adv-3 | Drop I3.7 (dim reasoning) because stderr dim inherits the stdout-keyed theme mismatch | **OVERRULED** — the errTheme graft (AT-1c consequence) dissolves the stated reason: reasoning dims via a stderr-keyed variant, which is correct on every stream combination. I3.7 returns at 0.5h. Disagreement recorded, not silently dropped. |

## Per-candidate counters (premature-convergence guard)

| candidate | attacks received | mutations drawn FROM it | mutations proposed BY its advocate |
|-----------|-----------------|------------------------|-----------------------------------|
| IDEA-1 | 4 | MUT-2.3 (I1.4/I1.8), MUT-2.4 (I1.7), MUT-3.1 (I1.2/I1.8), MUT-3.3 (I1.9) | 2 |
| IDEA-2 | 6 | MUT-3.2 (I2.6), MUT-1.2 (I2.4, rejected) | 5 |
| IDEA-3 | 5 | MUT-1.1 (I3.4), MUT-2.1 (I3.3), MUT-2.2 (I3.4), MUT-2.4 (I3.6), MUT-2.5 (I3.1) | 3 |

Guard: PASS — no strawman candidate; no early crowning (the eventual spine, IDEA-3, took 5 accepted attacks and had one element dropped by its own advocate then reinstated only via a rival-derived fix).
