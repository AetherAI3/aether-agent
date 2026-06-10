# Orchestrator-Gated Slash Commands

Add 4 new orchestrator-gated slash commands to the aether-agent REPL:
`/delegate`, `/tree`, `/broadcast`, `/gather`.

## Architecture

All commands are **REPL-only slash commands** — no new top-level CLI entries.  
Gate: runtime check on `ctx.flags.agent` — must be set (Neo/Kronus active).  
No persistent orchestrator rewiring — pure per-session runtime gate.

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/core/transport.ts` | MODIFY | Add 4 route constants |
| `src/core/orchestrator.ts` | CREATE | Types, API wrappers, gate helper |
| `src/commands/slash.ts` | MODIFY | 4 new cases + handlers + help |
| `test/slash.test.ts` | MODIFY | Gate rejection tests |

## Tasks

### Phase 1: Transport routes
- Add to `src/core/transport.ts` after the existing `AGENTS_PATH` line:
  ```
  AGENT_DELEGATE_PATH  = "/agents/delegate"
  AGENT_TREE_PATH      = "/agents/tree" 
  AGENT_BROADCAST_PATH = "/agents/broadcast"
  AGENT_GATHER_PATH    = "/agents/gather"
  ```

### Phase 2: Core module (`src/core/orchestrator.ts`)
- Types: `DelegateRequest`, `DelegateResponse`, `TreeWorker`, `TreeResponse`, `BroadcastRequest`, `BroadcastResponse`, `GatherResult`, `GatherResponse`
- API wrappers: `delegateWorker()`, `getOrchTree()`, `broadcastToAgents()`, `gatherResults()` — each wraps a single `api.postJson<T>()` or `api.getJson<T>()`
- Gate helper: `requireOrchestrator(ctx, out)` — checks `ctx.flags.agent`, writes rejection message if unset, returns boolean

### Phase 3: Slash command handlers
- Import from `../core/orchestrator.js`
- Add cases to `handleSlash` switch:
  - `"delegate"` → `delegateSlash(ctx, out, arg)` 
  - `"tree"` → `treeSlash(ctx, out)`
  - `"broadcast"` → `broadcastSlash(ctx, out, arg)`
  - `"gather"` → `gatherSlash(ctx, out, arg)`
- Each handler: gate check first → API call → render output
- `/tree` rendering: table with columns for worker ID, model, step, tokens, UVT
- Update `printHelp` with new "Orchestra" section

### Phase 4: Tests
- Test each slash command rejects with friendly message when no orchestrator active
- Test with fake context where `ctx.flags.agent` is set

### Phase 5: Build & verify
- `npx tsc -p tsconfig.json` — must compile clean
- Run slash tests: `node --test --import tsx test/slash.test.ts`

## Out of scope
- No new top-level CLI commands
- No orchestrator internal changes
- No backend endpoint implementation (assumes backend has these routes)
- No main.ts changes
