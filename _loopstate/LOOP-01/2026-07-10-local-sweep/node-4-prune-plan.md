# LOOP-01 node 4 - dead code and duplicate helper plan

No deletion is proposed in this foundation sweep. The existing graph reports 210 weakly connected nodes and inferred `main()` edges that require verification, but zero-inbound analysis is not reliable enough for TypeScript dynamic imports, registry dispatch, test hooks, and CLI entry points.

High-ripple modules to review before any prune:

- `src/core/transport.ts` - `ApiClient`, 25 inbound graph edges.
- `src/core/context.ts` - `AppContext`, 30 inbound graph edges.
- `src/core/tool_executor.ts` - protocol boundary and side-effect gate.
- `src/core/brain_protocol.ts` - wire compatibility boundary.
- `src/core/mcp.ts` - backend broker adapter.

Status: PLAN ONLY. Dynamic-dispatch candidates remain `unknown` and are excluded from mutation.
