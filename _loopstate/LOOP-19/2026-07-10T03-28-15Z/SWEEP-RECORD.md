# LOOP-19 · Sweep Record (fix & improvement sweep, operator-directed)

Branch `loop/LOOP-19-2026-07-09` continued: welds 17–29 (sweep W1–W13). Tests 172 → **183/183** at tip. Two hostile finder agents (core-correctness + UX/robustness) produced 20 findings; every fixed finding was verified in code before welding.

## Fixed this sweep (one weld each)

| weld | fix | source finding |
|------|-----|---------------|
| W1 | graceful exit kills the Windows one-shot libuv crash (+ first e2e one-shot test w/ fixture server) | audit #4 |
| W2 | weak tests closed: full registry-through-switch coverage (stubbed fetch), spawn-level typo-guard/fallthrough pins | audit #2, #3 |
| W3 | first-run `aether auth login` no longer ENOENTs (token store mkdir) | core#2 HIGH |
| W4 | cloud runs stop laundering failures into exit 0 (honest terminal done, hostLoop error precedence) + custody receipts persisted on the cloud code path | core#1 HIGH + core#8 |
| W5 | AETHER_BASE_URL env override never persists into config.json (E17 self-introduced, fixed same day) | core#7 = ux#1 HIGH |
| W6 | thinking pulse survives open/ping keepalives (dead-air fix actually works on keepalive servers) | ux#3 HIGH |
| W7 | pinned status line clamps to terminal width (segment-shedding; no more stale-row floods in splits) | ux#2 HIGH |
| W8 | status/telemetry stop writing `\r` into piped stderr; width-clamped on TTY | ux#6 |
| W9 | SSE decoder tolerates CRLF servers/proxies (was: zero frames, silently) | core#10 |
| W10 | host→brain wire ASCII-escaped per CONTRACTS.md invariant 3 + PYTHONUTF8=1 (cp1252 corruption/crash) | core#3 HIGH |
| W11 | dead local brain can't crash the CLI via stdin EPIPE | core#9 |
| W12 | /effort survives a hand-edited config (String coercion) | ux#9 |
| W13 | teardown always runs when the brain throws (no stale status over the fatal ✗) | ux#10 |

## Deferred findings — CLOSED OUT in a follow-up pass (not silently dropped)

Nine findings were deferred rather than rushed. The operator asked for a normal (non-ceremony)
follow-up pass; eight are now fixed as plain commits on this same branch. Tests 183 → **193/193**.

| id | finding | resolution |
|----|---------|-----------|
| D1 | core#4: server `error` frame in chat/run renders but exits 0 | **FIXED** — `runTurn` returns `false` on a streamed error frame; `cmdChat`/`cmdRun` map to exit 1. |
| D2 | core#5: `gitCommit` `\|\| echo` masks failures; shell-quoted message is injectable | **FIXED** — argv-form `spawnSync` (no shell); only "nothing to commit" is treated as benign, real failures surface with no fabricated sha. Real temp-git-repo tests, incl. an injection-payload commit message and a pre-commit-hook rejection. |
| D3 | core#6: `testCmd` defaults diverge (wire `pytest -q` vs host gate only with `--test-cmd`) | **FIXED — operator decision resolved via AskUserQuestion**: send `test_cmd:""` when unset, matching CONTRACTS.md's documented unverifiable-run signal (the host's own default). The other option (host-gate on the resolved default) risked false failures in non-Python repos. |
| D4 | ux#4: pulse repaints fight readline type-ahead echo mid-turn | **FIXED** — `ThinkingPulse` gained an `onPaint` hook; the REPL re-syncs readline's input line after every repaint via `_refreshLine()`. Does NOT pause readline (would reopen the Ctrl+C-goes-dark risk from coherence check #1). |
| D5 | ux#5: SIGINT during a network slash command exits the whole session; `getJson` has no timeout | **FIXED** — `getJson`/`fetchTrail`/`getCatalog`/`handleSlash` thread an `AbortSignal` the same way `runTurn` already does; the REPL wraps slash dispatch in its own `AbortController` wired to the same SIGINT handler. |
| D6 | ux#7: clip/argHint can slice surrogate pairs → mojibake | **FIXED** — one shared `clipCodePoints()` in theme.ts, adopted at all four sites (diff.ts, ledger.ts, both `argHint`s). |
| D7 | ux#8: `saveConfig` non-atomic (torn write can silently reset config to defaults) | **FIXED** — write-then-`renameSync` (atomic on POSIX and NTFS). |
| D8 | `SseEventSource` in agent_events.ts is dead code with a broken decode if ever wired | **FIXED (removed)** — confirmed zero callers anywhere in src/ or test/; deleted rather than half-fixing something nobody calls. File header corrected (it described a cloud/local split that isn't how the code actually works — both brains feed the same `LocalAgentSource`). |
| D9 | paste burst-batching (a 10-line paste fires 10 sequential turns) | **STILL DEFERRED** (register R6/R9) — the real fix needs raw-mode input ownership, the same structural work as the rejected alt-screen rebuild (register R1). Not rushed as a partial hack. |

## Verification note

Sweep #1: every weld ran the full suite green before commit (`npm test`, exit-code-checked). No
separate end-of-sweep LOOP-11 gate was run — every fix came FROM an adversarial finder and carries
its own regression test where testable (W3, W4, W5, W9, W10 + W1/W2's e2e pins); W6-W8, W11-W13 are
one-guard welds verified by suite + reasoning, disclosed here.

Sweep #2 (deferred-findings close-out): plain commits, no ratchet-weld ceremony (operator correction:
"do normal testing like claude code or hermes agent, dont do strict rule if it doesnt make sense").
Each fix still got a real regression test where the bug was reachable (D1-D2, D3, D5-D7) and `npm test`
green before every commit; D4 and D8 are guard/removal changes verified by the suite + a piped-REPL
smoke rather than a dedicated new test file, disclosed here rather than padded with one.
