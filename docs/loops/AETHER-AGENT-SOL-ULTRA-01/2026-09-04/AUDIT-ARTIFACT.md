# AETHER-AGENT-SOL-ULTRA-01 Audit Artifact

Run: `2026-09-04`
Agent base: `bb000edc4ca5c89891ac7352aaf688916ca58bc7`
Cloud PR head: `ee60ab47f881b52e1779e7831282525b6c90c84d`
Voice contract provenance: `f91d677ece3c76c21a09db071ce796c5b2e8c6ea`
Verdict at commit construction: **LOCAL CANDIDATE READY; AGENT HOSTED CI PENDING**

## Outcome

The candidate implements typed chat/code/embedded turn outcomes, bounded transport and host operations, 0-UVT failure UX, replay-safe terminal remounts, default-off portable Voice, a typed transactional settings control center (including reset preview), a closed safe JSON subset editor for `.aether-ci.yml`, and bounded MCP diagnostics. Cloud PR #1483 is open and green at its exact head. The Agent PR and its exact-head hosted checks are deliberately external evidence created after this file is committed; this file cannot self-record its own commit hash.

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| ASU-001 | HIGH | Agent PR/exact-head hosted checks do not exist until this candidate is pushed | PENDING external gate |
| ASU-002 | HIGH | `TuiLayout` has no in-repository production caller | OPEN; deterministic pager/layout proof only |
| ASU-003 | HIGH | Standalone Voice has no OS capture/playback adapter | UNPROVEN; command reports exact prerequisites |
| ASU-004 | HIGH | Live browser/Electron refresh, physical devices, and deployed zero-balance billing were not exercised | UNPROVEN |
| ASU-005 | MEDIUM | Online entitlement, Actions execution, and adaptive-context runtime ports are absent | EXPLICITLY UNAVAILABLE |
| ASU-006 | MEDIUM | Workers used logical file leases in one Agent checkout rather than private worktrees | DEVIATION; final actual-diff audit required |
| ASU-007 | MEDIUM | Cloud PR #1483 required jobs | CLOSED: green at `ee60ab4`, run `33840680420` |
| ASU-008 | MEDIUM | Deterministic MCP failure/cancellation coverage exists; live OAuth and live Ollama remain absent | MODELED / live paths UNPROVEN |
| ASU-009 | HIGH | Initial Agent head used an unkeyed settings revision hash over a document containing a structural secret reference | REPAIRED locally with a process-random HMAC and regression; hosted rerun pending |

## Evidence

- The first complete candidate run reached 2,089 passes, then exposed two Windows file-symlink fixture `EPERM`s and two stale historical-evidence assertions. Those harness defects were repaired; the two link-only subcases now skip explicitly when Windows cannot create file links.
- A second complete run reached 2,091 passes and exposed one transient Windows atomic-rename `EPERM`. The durable store now retries only `EACCES`/`EBUSY`/`EPERM`, six bounded attempts over at most 75 ms; the affected 14-test file then passed five consecutive runs.
- The final complete run after the CodeQL repair is clean: 2,104 total, 2,093 passed, 0 failed, and 11 explicit platform skips.
- Typecheck, generated-doc drift, production verification, release truth (12/12), package dry-run (718 entries), and `git diff --check` pass. The unchanged dependency lock reported 0 vulnerabilities before the security-only repair; two post-repair registry calls timed out, so the subsequent exact-head hosted supply-chain gate is authoritative.
- Focused integrated lifecycle/settings/terminal tests: 88/88.
- Settings and generated-doc surface: 75 pass, 0 fail, 1 Windows file-link skip.
- Voice/MCP/bridge/status surface: 67/67.
- Terminal/TUI suite: 47/47 in five consecutive runs; expanded focused terminal suite 48/48.
- Cross-lane stress: 100 terminal outcomes (34 success, 33 failure, 33 cancel), maximum source listeners 1, and zero measured listener/resource deltas.
- Cloud PR #1483 required jobs passed: Python 17m41s, Site 10m4s, Web 6m14s, Desktop 1m18s, plus frontier, hosted-actions, UID boundary, and Vercel contexts. Scope-inapplicable deploy/ledger/Supabase jobs skipped.

Final local commands are recorded in `ci-exact-head-evidence.md`; hosted Agent results are authoritative in the PR/check run bound to the pushed head. Deterministic fakes do not prove real browser, Electron, microphone, speaker, hosted entitlement, Actions runner, paid model, or deployed billing behavior.

## Governance

No merge, tag, publish, release, deployment, migration, billing change, or authority weakening is authorized or performed. Cloud and Agent `main` remain untouched pending human approval.
