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

## Deferred → register (nothing silently dropped)

| id | finding | why deferred | suggested shape |
|----|---------|-------------|-----------------|
| D1 | core#4: server `error` frame in chat/run renders but exits 0 | needs a runTurn signature change rippling through 3 callers — clean but not a one-liner; do as its own weld with fixture tests | runTurn returns {ok}; cmdChat/cmdRun map to exit 1 |
| D2 | core#5: gitCommit `\|\| echo` masks failures; shell-quoted message is injectable (cmd.exe %VAR%, POSIX $()) | tool_executor rework + brain-visible output contract must stay `[exit N]` — needs care + tests | spawnSync argv form; detect "nothing to commit" from git output |
| D3 | core#6: testCmd defaults diverge (wire says `pytest -q`, host gate runs only with --test-cmd → brain-verified runs still print "unverified") | protocol-adjacent semantics — operator should pick: send `test_cmd:""` when unset (wire change vs Python brain) or host-gate on the resolved default (false failures in JS repos) | operator decision |
| D4 | ux#4: pulse repaints fight readline type-ahead echo mid-turn (input flickers, runs later as "ghost" queued line) | rl.pause() would break mid-turn Ctrl+C (coherence #1); the safe fix is pulse-repaints-readline-row coordination — small design task | pulse.onFrame → rl.\_refreshLine() or pause pulse on keypress |
| D5 | ux#5: SIGINT during a network slash command exits the whole session; getJson has no timeout | mirror of the turn path — per-slash AbortController + timeout; medium change | wire SIGINT to a slash-scoped controller |
| D6 | ux#7: clip/argHint can slice surrogate pairs → mojibake | multi-file shared-helper change; cosmetic corruption only | code-point clip helper in theme.ts, adopt in 4 sites |
| D7 | ux#8: saveConfig non-atomic (torn config.json silently resets to defaults incl. baseUrl) | small but touches every save path; do with a tmp+rename test | writeFileSync tmp + renameSync |
| D8 | SseEventSource in agent_events.ts is dead code with a broken decode if ever wired | deletion is the right fix but it's referenced by the file's own docs — operator taste | delete or fix when wiring |
| D9 | E15 paste burst-batching (register R6, unchanged) | raw-mode ownership is the real fix (register R1) | interim: queued-lines batch |

## Verification note

Each weld ran the full suite green before commit (`npm test`, exit-code-checked). No separate end-of-sweep LOOP-11 gate was run — every fix came FROM an adversarial finder and carries its own regression test where testable (W3, W4, W5, W9, W10 + W1/W2's e2e pins); W6-W8, W11-W13 are one-guard welds verified by suite + reasoning, disclosed here.
