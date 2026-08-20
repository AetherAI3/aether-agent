# Complexity report

## Method

- Parsed 129 TypeScript files in `src/` and `scripts/` with the TypeScript 5.9.3
  compiler API used only as an analysis tool.
- Cyclomatic complexity starts at 1 per function and adds one for conditional,
  loop, catch, case, ternary, and `&&`/`||`/`??` branch points. Nested functions
  are counted separately.
- Static dependency degree and depth include relative imports and re-exports in
  128 `src/` files: 424 edges, maximum SCC-collapsed depth 10.
- Cognitive complexity and a complete call graph are unmeasured because no
  compatible analyzer/code-graph service is configured. Import degree is not
  mislabeled as call-graph size.
- Thirty-seven classes were found; the six `extends` clauses all directly extend
  built-in `Error`, so observed local inheritance depth is 1.

## Aggregates

| metric | value | threshold / interpretation |
|---|---:|---|
| TypeScript files | 129 | `src` plus production verification script |
| functions | 1,306 | AST function-like nodes |
| functions with cyclomatic > 10 | 88 (6.74%) | watch |
| files > 800 lines | 1 | house-limit breach |
| maximum dependency depth | 10 | baseline |
| import SCCs with >1 member | 1 | one type-level cycle |
| maximum inheritance depth | 1 | low |
| cognitive complexity | unmeasured | unsupported by configured analyzer |
| call-graph size | unmeasured | no call-graph service configured |

## Top-20 function risk ranking

| rank | function | cyclomatic |
|---:|---|---:|
| 1 | `src/commands/slash.ts:102 handleSlash` | 86 |
| 2 | `src/core/stream.ts:79 normalizeFrame` | 69 |
| 3 | `src/commands/chat.ts:684 anonymous handler` | 53 |
| 4 | `src/main.ts:50 main` | 47 |
| 5 | `src/commands/code.ts:102 cmdCode` | 44 |
| 6 | `src/ui/keys.ts:75 decodeKey` | 43 |
| 7 | `src/commands/goals.ts:76 handleGoal` | 35 |
| 8 | `src/core/render.ts:65 frame` | 33 |
| 9 | `src/ui/text.ts:19 charWidth` | 33 |
| 10 | `src/commands/memory.ts:80 cmdMemory` | 30 |
| 11 | `src/commands/chat.ts:554 anonymous handler` | 29 |
| 12 | `src/commands/slash_media.ts:27 parseSlashFlags` | 27 |
| 13 | `src/ui/host_render.ts:81 event` | 26 |
| 14 | `src/core/web.ts:87 isBlockedIPv6` | 24 |
| 15 | `src/ui/logs_viewer.ts:59 viewerReduce` | 24 |
| 16 | `src/commands/goals.ts:22 decomposeGoal` | 23 |
| 17 | `src/commands/media.ts:54 parseFlags` | 23 |
| 18 | `src/commands/slash_hud.ts:64 hudSlash` | 23 |
| 19 | `src/commands/slash_media.ts:195 storyboardSlash` | 23 |
| 20 | `src/core/session_log.ts:50 loggedEvent` | 23 |

The new `scripts/verify-production.ts` has three functions over 10:
`validateWorkflowText` 23, `validatePack` 16, and `validateManifest` 15. These
are pure policy validators with focused tests and are tracked as part of this
branch's delta, not silently omitted.

## God-file and high-degree watchlist

Top decile is 13 of 128 source modules. `src/commands/chat.ts` also breaches the
800-line house limit.

| file | lines | fan-in | fan-out | degree | reason | delta |
|---|---:|---:|---:|---:|---|---|
| `src/core/transport.ts` | 421 | 40 | 2 | 42 | top decile | initial |
| `src/ui/theme.ts` | 67 | 37 | 1 | 38 | top decile | initial |
| `src/commands/chat.ts` | 967 | 4 | 32 | 36 | top decile and >800 | initial |
| `src/core/context.ts` | 32 | 31 | 3 | 34 | top decile | initial |
| `src/commands/code.ts` | 445 | 1 | 26 | 27 | top decile | initial |
| `src/commands/slash.ts` | 490 | 1 | 19 | 20 | top decile | initial |
| `src/main.ts` | 253 | 0 | 19 | 19 | top decile entrypoint | initial |
| `src/index.ts` | 27 | 0 | 17 | 17 | top decile public barrel | initial |
| `src/core/brain_protocol.ts` | 338 | 14 | 0 | 14 | top decile contract leaf | initial |
| `src/core/errors.ts` | 131 | 14 | 0 | 14 | top decile error leaf | initial |
| `src/core/tool_executor.ts` | 280 | 10 | 4 | 14 | top decile | initial |
| `src/commands/mcp.ts` | 407 | 0 | 13 | 13 | top decile dynamic entrypoint | initial |
| `src/ui/text.ts` | 146 | 13 | 0 | 13 | top decile utility leaf | initial |

No growth verdict is possible until a subsequent run uses this snapshot.
