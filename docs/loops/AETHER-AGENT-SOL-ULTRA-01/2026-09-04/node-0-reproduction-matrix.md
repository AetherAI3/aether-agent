# Node 0 — Reproduction Matrix

`PASS` below means deterministic candidate evidence only. Real services/devices are named separately.

| Failure class | Regression | Result | Limit |
|---|---|---|---|
| 402 before SSE, after deltas, or empty body | chat/turn lifecycle fixtures | PASS: actionable, prompt preserved, nonzero, no fallback | deployed zero-balance unproven |
| JSON/headless terminal | structured outcome fixtures | PASS: one `aether.turn/1` result | external consumers unproven |
| EOF/error/late frames | chat/code/terminal lifecycle | PASS: incomplete/failed; late work rejected | live socket behavior unproven |
| Quiet or delimiter-free stream | transport/SSE tests | PASS: idle/body/event bounds | real proxy timing unproven |
| Cosmetic alternating progress | chat/code/event-source tests | PASS: cannot extend deadline forever | deterministic clocks |
| Cancellation during iterator/tool/verify | local chat and code host tests | PASS: signal, close, process reap contract | physical subprocess matrix limited |
| Remount during stream | atomic replay/gap tests | PASS: unseen seq once; gaps visible; deadline preserved | browser/Electron unproven |
| Resize/scroll/history | pager/layout tests | PASS: logical anchor and reachable wrapped rows | `TuiLayout` dormant |
| 20x5–200x60, hostile metrics/controls | capability/settings/TUI tests | PASS | real fonts/TTY unproven |
| MCP missing/hanging/malformed/cancel | MCP command/core/lifecycle/diagnostics | PASS: bounded, redacted, no stdio child authority | live OAuth unproven |
| Settings read/plan/apply/cancel/reset races | settings suites | PASS: locks, CAS, exact rollback/compensation | external ports unproven |
| Mic denied/missing/provider hangs | Voice controller tests | PASS in fake ports | physical mic unproven |
| STT 402; TTS 402/503/playback failure | Voice transport/controller | PASS: text remains, speech degrades | deployed billing unproven |
| Barge-in and playback allocation | Voice session/queue tests | PASS | live audio timing unproven |
| Repeated mixed lifecycle | 100-cycle cross-lane stress | PASS: 34/33/33, zero measured deltas | fake resources |
| Windows atomic rename contention | media history file | PASS five consecutive 14/14 runs after bounded retry | exact antivirus behavior nondeterministic |
