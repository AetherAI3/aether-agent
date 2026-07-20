# Duplication and dead-surface analysis

The duplicate scan used exact ten-meaningful-line windows across 128 `src/*.ts`
files, then grouped overlapping windows and manually confirmed same-runtime
semantics.

## Duplication

| ID | family | evidence | classification | route |
|---|---|---|---|---|
| L13-003 | memory event shape | `src/core/brain_protocol.ts:89`, `src/core/stream.ts:35`, `src/ui/status_renderer.ts:21` repeat the same memory-frame fields | confirmed structural duplication | LOOP-01: establish one shared contract without coupling UI upward |
| L13-004 | media flag parsing | `src/commands/media.ts:54` and `src/commands/slash_media.ts:27` duplicate model/aspect/count/4k/vector/duration/1080p/audio/save/ref/open parsing | confirmed same-runtime behavior duplication | LOOP-01: extract a shared pure parser |
| L13-005 | progress rendering | `src/ui/tui_layout.ts:340`, `src/ui/status_renderer.ts:243`, and `src/ui/progress.ts:5` independently implement progress bars | confirmed feature duplication with two intentional visual variants | LOOP-02 or LOOP-06: consolidate calculation while preserving styles |

The raw scan yielded 16 overlapping windows, all collapsing into the first two
families above; overlapping windows are not counted as separate debt.

## Dead surface

| ID | surface | inbound evidence | external-contract check | verdict |
|---|---|---|---|---|
| L13-006 | `src/ui/tui_layout.ts` / `TuiLayout` | zero production static or dynamic callers; constructor references occur only in `test/tui.test.ts` | not exported by `src/index.ts`; package exports exposes only the root API | suspected-dead prototype, MEDIUM; operator confirmation required before deletion |

Zero-static-inbound command modules such as `commands/mcp.ts`, `audit.ts`,
`doctor.ts`, `memory.ts`, `receipt.ts`, and `config.ts` are **not dead**: `main.ts`
and `commands/slash.ts` load them dynamically. `src/main.ts`, `src/index.ts`,
`core/smoke.ts`, and the public `terminal_session.ts` are entrypoints. No route or
service was asserted dead without inbound and external-contract evidence.

No separately deployed service declarations exist in this repository, so there
is no dead-service finding. Actual external API traffic remains unknown.
