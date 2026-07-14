---
operator: PR44-SIMPLIFY-AUDIT
status: ready-for-review
scope: PR #44 simplify + 15-domain audit + 17-persona sparring-partner verify
run-id: 2026-07-14
branch: loop/pr44-hostile-simplify-2026-07-10
---

# PR #44 simplify/audit/harden pass — operator artifact

## What this is

A follow-on pass over PR #44 (already carrying an earlier 17-agent hostile
security/CI sweep merged via #46, plus a LOOP-17-hostile self-critique). This
run's brief: simplify the PR, fix the messy/unlabeled loop-process artifacts,
and run a broader audit — 15 independent domain-lens finders (one per
LOOP-01..LOOP-15 domain from the shared loop kernel) followed by a 17-persona
adversarial sparring-partner panel that votes 3-per-finding, 2-of-3 to
confirm — before applying anything.

## Naming-scheme note (a finding in itself)

This repo runs **two parallel, uncross-referenced loop-numbering schemes**:
`AA-LOOP-XX` (this repo's own local convention — `docs/operator/AA-LOOP-04.md`)
and generic `LOOP-XX` from the shared kernel (branch `loop/LOOP-19-2026-07-09`,
`_loopstate/LOOP-19/`). That collision is part of why this PR was hard to sort.
This artifact is deliberately named `PR44-SIMPLIFY-AUDIT`, not another
`LOOP-NN`, to avoid adding a third ambiguous number.

## Results

- 15/15 domains reported (LOOP-03 mobile-native correctly returned
  `applicable: false` — this is a terminal CLI, not a mobile app).
- 54 raw findings → **42 confirmed** (2-of-3 sparring-partner vote) / 12
  rejected (mostly duplicate findings from a second domain lens, already
  fixed by the time they were verified) / 5 explicitly operator-deferred.
- An account rate-limit interrupted the verify pass twice mid-run; both
  times the fallback logic risked mis-bucketing an unreviewed finding as
  "rejected" (zero votes look the same as a real 2-of-3 refutation). Fixed
  by resuming to completion rather than trusting the partial result —
  final numbers above are from the fully-completed run (0 agent errors).

## Incident: shared-worktree data loss (read before trusting any prior summary)

Mid-run, something in this checked-out worktree (`aether-agent-pr44`) reverted
most of the apply phase's uncommitted edits back to HEAD — one apply agent
detected and self-healed this for `test/tui.test.ts` mid-task; ~14 other
files were not so lucky and silently lost their edits. Root cause not fully
isolated; likely one of many concurrent Bash-capable apply agents ran a
repo-wide git operation instead of scoping to its own file. **Every fix
below was manually re-verified against the actual file on disk and
re-applied by hand (not by re-trusting a subagent's self-report) before this
artifact was written.** Lesson for future multi-agent passes on this
codebase: prefer `isolation: 'worktree'` for any apply phase where agents
have Bash access, even when edits are nominally disjoint-by-file.

## Applied (18 files, all re-verified against disk, 646/646 tests green)

- **src/core/web.ts** [high] — `requestPinned()` never negotiated/decompressed
  `Content-Encoding`; a compressed response silently returned garbled bytes.
  Fixed: send `Accept-Encoding: gzip, br, deflate`, decompress via
  `node:zlib` keyed off the response header, fall back to raw bytes on
  decode failure.
- **src/core/vision.ts** [medium] — `downloadMediaFile`'s credential-safe-URL
  guard threw unconditionally even with no bearer token to leak. Fixed:
  now conditioned on `Authorization` actually being present, matching
  `transport.ts`/`vault.ts`'s existing token-conditional pattern.
- **src/core/transport.ts** [medium] — `ApiClient.request()`'s success path
  had no defensive handling for an empty/non-JSON 2xx body (e.g. 204 from
  the new `deleteJson()`). Fixed: try/catch → `undefined`, mirroring
  `toHttpError()`'s existing pattern.
- **src/commands/audit.ts** [high] — custody/audit-trail fields written
  straight to the terminal, unlike every other server/model-controlled
  string in this PR. Fixed: routed through `sanitizeTerm()`.
- **src/core/auth.ts** [medium] — `FileTokenStore` read/wrote the session
  token via plain path-based calls, transparently following a symlink.
  Fixed: `O_NOFOLLOW` on both `get()`/`set()`, mirroring `tool_executor.ts`.
- **src/core/goals.ts** [high+medium] — `saveGoals()` used a bare
  `writeFileSync` with no repair path if interrupted mid-write; every
  pre-upgrade (cwd-less) goal became permanently, silently unreachable.
  Fixed: atomic tmp+rename write; opt-in `includeUnscoped` option on
  `goalsForWorkspace`/`getGoalForWorkspace` (default off, existing test's
  exclusion behavior preserved).
- **src/core/history_store.ts** [low] — compaction rewrite was a bare
  `writeFileSync`; fixed to atomic tmp+rename.
- **src/core/session_log.ts** [low] — `sessionId` collision on same-millisecond
  same-brain invocations could silently wipe a concurrent session's events.
  Fixed: `process.pid` folded into the id.
- **src/commands/code_support.ts** [high] — `writeDiffLines` never checked
  `snapshot()`'s `"unsafe"` reason, fabricating a clean diff preview for a
  `write_file` call the workspace guard was about to reject. Fixed: early
  return on `reason === "unsafe"`.
- **src/core/cloud_memory.ts** [medium] — "QOPC" used pervasively with zero
  definition anywhere. Fixed: doc comment on `QOPC_MEMORY_PATH`.
- **src/core/memory.ts** [high/medium/low ×4] — doc comment explaining the
  four memory tiers and disambiguating this "semantic" tier from the
  unrelated `vault` command's "semantic memory"; removed unused `export` on
  `defaultMemoryRoots` (zero external importers, confirmed via grep).
- **src/commands/memory.ts** — tier list + error string de-duplicated into
  one `TIER_LIST` array (in-file only; full cross-file unification would
  need a runtime export added to `core/memory.ts`, left as a follow-up).
- **src/ui/host_render.ts** [medium] — an embedded `\n` in any `BrainEvent`
  field could break the one-line-per-event terminal contract and impersonate
  an adjacent status line (e.g. a fake `[ OKAY ]`). Fixed: `oneLine()`
  helper (sanitizeTerm + collapse `\n`/`\t`) at every single-line site.
- **src/core/diagnostics.ts** [low] — `doctor`'s Node-version check said
  `>=20`, contradicting `package.json`'s actual `>=24` floor. Fixed.
- **.github/workflows/ci.yml** [medium] — `on.push`+`on.pull_request` both
  fire per commit on a same-repo PR branch, double-running CI. Fixed:
  added a `concurrency` group with `cancel-in-progress`.
- **test/cli_registry.test.ts** [high] — parity test only checked one
  direction. Fixed: added the reverse check, with the one legitimate
  exception (`help`, dispatched before the switch in `main.ts`) discovered
  via an actual failing test run, not assumed.
- **_loopstate/governance-ledger.md** — added a schema-documenting header;
  see also the new row for this run below.
- **docs/operator/AA-LOOP-04.md** — stale test count (524→645) corrected;
  Acceptance bullet now reflects that the 17-file cleanup is actually done.

## Reverted after regression testing (2 findings, real but wrongly-scoped fix)

Both of these were **confirmed real** by the sparring-partner panel, but the
single-file fix that was applied broke a test protecting *legitimate*
behavior — not a bad test, a too-blunt fix. Reverted to HEAD; recommend a
proper cross-file fix as follow-up work, not shipped here:

- **src/core/tool_registry.ts** [high] — `validateToolCall` rejects a whole
  tool call on any unrecognized argument key, which spuriously rejects valid
  Ollama-model calls (its schema declares `additionalProperties: true`).
  The applied fix made the allowlist check fail-open **for every caller**,
  which silently defeated `test/tool_registry.test.ts`'s deliberate
  command-injection canary (`validateToolCall("repo_search", {query:"x",
  command:"whoami"})` expects rejection). Correct fix: narrow the relaxation
  to the Ollama tool-schema construction (`brain_ollama.ts`), not the shared
  validator.
- **src/core/git_commit_guard.ts** [high] — `SpawnGitRunner` runs real `git`
  with no hook suppression; a prompt-injected turn could plant a pre-commit
  hook via the tool surface's own `write_file` path (no `.git/` denylist).
  The applied fix (`core.hooksPath` redirect + `core.fsmonitor=`)
  neutralized **all** hooks, including a legitimate, user-installed
  pre-commit hook that `test/tool_executor.test.ts`'s
  `"git_commit surfaces a real failure instead of reporting the old HEAD as
  success"` test deliberately exercises. Correct fix: add a `.git/` write
  denylist in `tool_executor.ts` (a different file) so the attack surface is
  closed at the point of injection, not by disabling hooks wholesale.

## Confirmed-but-out-of-scope-for-a-single-file-fix (documented, not applied)

- **src/core/mcp_diagnostics.ts** [medium] — `bounded()` never cancels the
  underlying broker request on timeout; real fix needs an `AbortSignal`
  threaded through `McpClient.listProviders/listConnections/listTools` in
  `src/core/mcp.ts`.
- **src/commands/slash_git_tools.ts** [high] — `/rollback`/`/revert` resolve
  via `process.cwd()` instead of `ctx.flags.cwd`, inconsistent with every
  other reworked component in this PR.
- **src/core/autonomy.ts** [high] — `gateActionFor` never maps the new
  `sideEffect: "network"` category, so `decideGate` unconditionally
  `"allow"`s network tool calls even in `"ask"` mode with no TTY (fails
  closed for write/shell/git, not network).
- **src/core/context_registry.ts** [low] — `loadFromBackend`'s
  `Object.assign` silently drops `tempFiles` on cloud-context resume
  (`fromSnapshot` never sets it).
- **src/commands/memory.ts** [medium] — `agenticBackend`'s `"cloud-only"` /
  `"qopc"` values read backwards from their real meaning in CLI output;
  fixing it touches `commands/memory.ts`'s comparison, its printed header,
  and 3 exact-literal test assertions.
- **src/core/history_store.ts** / **test/history_store.test.ts** — new
  per-workspace `historyPath(cwd)` scoping has zero direct test coverage.
- **src/core/git_commit_guard.ts** / **test/git_commit_guard.test.ts** — the
  TOCTOU "worktree changed after staging" drift-check has zero test
  coverage of its actual triggering behavior.

## Operator-deferred (informational only, not auto-applied)

- `package.json:33` — `node --test --test-isolation=none` shares process
  state across all 646 tests. Flagged independently by 3 domain lenses.
  Probed directly: `--test-isolation=process` and reversed file order both
  still pass 645/645 — no active masking found, but it's not a structural
  guarantee. Already an acknowledged open decision in `AA-LOOP-04.md`.
- `_loopstate/governance-ledger.md` — this PR's own AA-LOOP-04 and
  LOOP-17-hostile runs computed confidence scores (0.95) but never appended
  a row before their evidence was deleted; the ledger permanently lost
  visibility into both runs. This run's row (below) does not retroactively
  recover that — flagging so it isn't repeated.

## Verification

- `npm test`: 646 pass, 0 fail, 0 skipped (up from the 645-pass baseline —
  the earlier LOOP-17-hostile pass's restored `test/tui.test.ts` heartbeat
  test).
- `npm audit --omit=dev --audit-level=high`: 1 low-severity advisory
  (`esbuild`, dev-only transitive, pre-existing, unrelated to this PR).
- `tsc -p tsconfig.json` clean.
- Removed per AA-LOOP-04.md's own Acceptance bar: `docs/loops/AA-LOOP-01/02`,
  `docs/plans/2026-07-09-aa-loop-0{1,2}-*-spec.md`,
  `_loopstate/LOOP-19/2026-07-10T03-28-15Z/*` (17 files) — kept
  `_loopstate/governance-ledger.md` (durable summary, not per-run scratch).

## Recommended next loops

- A scoped follow-up limited to `src/core/mcp.ts` + `src/core/tool_executor.ts`
  + `src/core/brain_ollama.ts` to properly land the two reverted findings
  (AbortSignal threading, `.git/` write denylist, Ollama-scoped arg
  relaxation) without the cross-file restriction that blocked them here.
- `src/commands/memory.ts` + `src/core/memory.ts` + `test/memory.test.ts`
  together, to fix `agenticBackend`'s backwards values.
- Reconcile the `AA-LOOP-XX` vs `LOOP-XX` numbering schemes, or at minimum
  cross-reference them from `docs/operator/`.
