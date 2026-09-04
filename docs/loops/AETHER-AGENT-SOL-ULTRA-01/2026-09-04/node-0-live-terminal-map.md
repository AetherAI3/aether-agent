# Node 0 — Live Terminal Topology

Recorded against Agent base `bb000edc4ca5c89891ac7352aaf688916ca58bc7`; convergence integrations are noted separately.

| Surface | Actual path | Renderer / terminal result | Cleanup owner | Evidence boundary |
|---|---|---|---|---|
| Bare `aether` in a TTY | `main` -> `cmdChat("")` -> `repl` -> `InputBuffer` -> `runTurn` | splash + line composer; cloud `Renderer` or local `HostRenderer`; typed `TurnOutcome` | REPL input/resize handlers and per-turn abort controller | Production CLI caller present; real PTY matrix unproven |
| `aether chat <prompt>` / bare quoted prompt | `main` -> `cmdChat(prompt)` -> `runTurn` | one-shot stream plus exactly one terminal outcome; JSON appends `aether.turn/1` record | `runCloudTurn` pulse/finally or `runLocalTurn` brain close/finally | Deterministic fixtures present |
| Persistent non-TTY/piped session | `cmdChat("")` -> `replLines` -> readline -> `runTurn` | plain line output; JSON terminal record when requested | readline close and named SIGINT listener removed in `finally` | Deterministic pipe path covered; shell-host matrix not exhaustive |
| Hosted chat turn | `runTurn` -> `resolveBackend` -> `runCloudTurn` -> `ApiClient.stream` -> `decodeSse` | `Renderer`; receipt/UVT registry; typed lifecycle | stream abort + pulse stop/finally | 401/402/error/EOF fixtures exist; deployed billing remains unproven |
| Local Ollama chat turn | `runTurn` -> `runLocalTurn` -> `Brain.run` -> host tool gate/executor | `HostRenderer`; typed lifecycle | signal listener removal + `brain.close()` | Synthetic brain fixtures exist; live Ollama models unproven |
| `aether agent` / `aether code` task | `main` -> `cmdCode` -> brain host loop -> `LocalAgentSource` -> host verify | `StatusRenderer` plus one typed outcome; brain `done` remains advisory | one command AbortController spans source, gate, tools, renderer and verifier; cleanup once | Deterministic timeout/cancel/late-tool coverage; live model unproven |
| MCP-enhanced chat | skill/run context -> cloud server tools or local `ToolExecutor` | same chat renderers | bounded supervisor and per-turn cleanup | Missing/hang/malformed/cancel modeled; live broker OAuth unproven |
| Embedded xterm API | external host -> exported `createTerminalSession({source,sink})` -> `bindEventSource` | `StatusRenderer` with host `RenderSink`; optional injected Voice controller | idempotent session `dispose()` | Public seam and tests proven; no in-repo Desktop/web caller; live integration `UNPROVEN` |
| Session resume/continue | `main` -> `cmdResume` or `cmdCode --resume` | resume command/host renderer | command-owned | Unchanged existing path; repeated live reconnect evidence pending |
| Browser/Electron refresh | external host recreates `TerminalSession` against `ReplayableAgentSource.subscribeAfter` | atomic unseen-event replay; gaps fail visibly; one outcome owner | old binding detaches; Voice/unbind/renderer dispose idempotently | Supported remount modeled; real browser/Electron `UNPROVEN` |
| Full-screen `TuiLayout` | exported class, tests, no production constructor found outside tests | alternate-screen pager/status layout | `mount`/`unmount` | **Dormant in repository production callers**; tests do not prove live CLI behavior |

## Fragmentation finding

The production terminal is not one renderer. Chat uses `Renderer`/`HostRenderer` and a custom REPL composer; code/agent and the embed seam use `StatusRenderer`; `TuiLayout` remains dormant. Convergence tests may share width, lifecycle, and cleanup primitives, but must not claim `TuiLayout` fixes the live CLI unless a production caller is added and verified.
