# Self-Heal Plan — Terminal Red-Team Findings (2026-06-09)

TDD throughout: test first (RED), minimal fix (GREEN), refactor. Test runner:
`npm test` (`tsc` build → `node --test dist/test/*.test.js`).

## Task 1 — C1: wire the permission gate into the agent loop

**Pure layer (`src/core/autonomy.ts`):**
- Add `gateActionFor(tool: string): GateAction | null` — `write_file→"write"`,
  `run_shell→"shell"`, `git_commit→"shell"`; everything read-only → `null`.
- Add `decideGate(tool, mode, autoApply, { yes, isTty }): "allow" | "deny" | "prompt"`:
  read-only → allow; `!needsPrompt` (skip / auto+autoApply) → allow; `yes` → allow;
  `!isTty` → **deny** (fail closed); else → prompt.

**Host wiring (`src/commands/code.ts`):**
- `ToolGate = (call: { name: string; args: Record<string, unknown> }) => Promise<boolean>`.
- `hostLoop(...)` gains an optional `gate?: ToolGate` (default = allow-all → backward
  compatible). On a tool call: if `gate` denies, synthesize
  `{ output: "[denied: <name> not approved by user]", exitCode: 1 }`, send it to the
  brain instead of executing.
- `cmdCode` builds the real gate from `ctx.cfg.permissionMode` + `ctx.cfg.autoApply`
  + `{ yes: ctx.flags.yes, isTty: !!process.stdin.isTTY }`, using `decideGate`; on
  `"prompt"` it calls `ctx.confirm(...)` showing the command/path.

**Tests (`test/autonomy.test.ts`, `test/code_wiring.test.ts`):**
- `decideGate` matrix: ask+TTY→prompt, ask+no-TTY→deny, skip→allow,
  auto+autoApply→allow, auto+!autoApply+TTY→prompt, yes→allow, read_file→allow.
- `hostLoop` with a fake brain emitting a `run_shell` tool_call + a denying gate →
  executor NOT called, brain receives a `[denied …]` tool_result.

## Task 2 — H1: refuse credentials over insecure transport

**`src/core/transport.ts`:**
- Add `isCredentialSafeUrl(base): boolean` (https anywhere; http only loopback).
- `authHeaders()` throws when a token exists and `!isCredentialSafeUrl(baseUrl)`.

**Tests (`test/transport_security.test.ts`, new):**
- `isCredentialSafeUrl` matrix (https ok, http+localhost ok, http+evil no, junk no).
- `ApiClient` with a `StaticTokenStore` + `http://evil.test` base: `getJson` rejects
  with the insecure-transport error (before any network).
- `http://localhost` + token → no throw from `authHeaders` path.

## Task 3 — M1: token file/dir permissions

**`src/core/auth.ts`:** create dir `mode 0o700`, write file `{ mode: 0o600 }`, keep
`chmod` fallback.
**`src/core/config.ts`:** `saveConfig` mkdir `mode 0o700`.

**Tests (`test/auth.test.ts`):** `set()` writes the token and reads back; on
non-Windows, assert file mode `0o600`.

## Task 4 — M2: tighten `parseRepoSpec`

**`src/core/repo.ts`:** reject any owner/name segment equal to `.`/`..` or starting
with `-`.
**Tests (`test/repo.test.ts` or existing):** `-x/y`, `../y`, `a/..` throw;
`owner/name`, `a.b/c-d` still parse.

## Order / verification
1, 2, 3, 4 are independent. Implement each test-first, then `npm test` green for the
whole suite before commit. One commit per task or one cohesive security commit;
open PR `sec/terminal-redteam-hardening` → `main` summarizing C1/H1/M1/M2 and the
non-TTY fail-closed behavior change for review.
