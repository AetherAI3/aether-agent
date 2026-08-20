# LOOP-01 / Lane SC-A0 — Skills & Health Integration Rescue — Semantic Conflict Matrix

run_id: sc-a0-2026-08-19
date: 2026-08-19
target: AetherAI3/aether-agent
branch: supercluster/a0-skills-health-integration
base_sha: 41a7e261c7fef6cefabbb83c62f70646fde63529   (origin/main, fetched this run)
pr71_head: a868f7d02008e04f2c0c8ce2b94b03ccba7c2a70
merge_base: b98ef26d16daf61a32a6c0ca437172d794b2efe1

## Verdict

BLOCKED-PENDING-IMPLEMENTATION — intake and contract complete; no code written yet.

## Fetched baseline (not inherited from the prompt)

| Fact | Prompt audit ref | Actually fetched 2026-08-19 | Status |
| ---- | ---------------- | --------------------------- | ------ |
| origin/main | 41a7e261… | 41a7e261… | confirmed |
| PR #71 head | a868f7d0… | a868f7d0… | confirmed |
| PR #71 merge base | b98ef26d… | b98ef26d… | confirmed |
| PR #71 state | (unstated) | OPEN, **mergeable=CONFLICTING** | new |
| PR #71 size | (unstated) | 100 files, +9157 / -343, 16 commits | new |
| PR #71 CI | (unstated) | **no statusCheckRollup entries at all** | new |

## Root cause of the conflict

`b98ef26d` (2026-08-12) is the last commit both sides share.

* **main** then took `27c100d8` (2026-08-14 **14:42**) — PR #66 "durable media output
  history, one safe opener, and aether doctor v2".
* **PR #71** branched at `b98ef26d` and its last commit is `a868f7d0`
  (2026-08-14 **22:49**) — 8 hours later on the clock, but authored against the
  08-12 tree and therefore **blind to PR #66**.

Both independently built something called "doctor v2" in the same 48 hours.
This is not a rebase problem. It is two competing report contracts that both
declare schema version 2.

## Textual conflicts (4 files — the small part)

    COMMANDS.md                 1 hunk
    src/commands/doctor.ts      3 hunks
    src/core/diagnostics.ts     1 hunk (whole file)
    test/diagnostics.test.ts    3 hunks

## Semantic conflict matrix (the real part)

### C1 — the doctor report contract  (highest severity)

| | current main | PR #71 |
| --- | --- | --- |
| home | `src/core/health.ts` (185L) | `src/core/diagnostics/contracts.ts` (72L) |
| report type | `HealthReport`, camelCase | `DoctorReportV2`, snake_case |
| version claim | `DOCTOR_SCHEMA_VERSION = 2` | `schema_version: 2` |
| configured / reachable / verified | **`Axis` objects**, `state` in {yes,no,unknown,na,not-checked} + evidence | **plain `boolean`** |
| mode | `fast \| live \| fix` | `fast \| network \| live \| fix` |
| severity | `info \| warning \| error` | `info \| warning \| critical` |
| redaction | `redact()` / `redactCheck()` | structural claim `evidence:{metadata_only:true}` |
| newer? | **yes** (2026-08-14 14:42, on main) | no (authored against 08-12 base) |

**Which is safer:** main's. A `boolean verified` cannot express *not-checked*.
In fast mode — which by contract performs no network I/O — every remote axis is
unchecked, so PR #71's shape must emit `verified:false`, which is indistinguishable
from *checked and failed*. main's `not-checked` axis state keeps those distinct.

This is exactly the frozen invariant the lane is required to preserve:
"Keep configured, reachable, and verified semantically distinct" and
"A doctor probe must not report verified unless that exact path was exercised
in the current run."

**Chosen contract:** main's `health.ts` 3-axis model is canonical.
PR #71's `DoctorCheckV2` boolean triple is **dropped**, not merged. Shipping both
would put two mutually-incompatible payloads behind one `schema_version: 2`.

**Test proving the choice:** a fast-mode run must emit `state:"not-checked"` on every
remote axis and must not emit any boolean-shaped `verified` field. Mutating
`notChecked()` to return `axis("no")` must fail that test.

### C2 — `--deep`

| | current main | PR #71 |
| --- | --- | --- |
| meaning | read-only alias of the fast report; prints where the new behaviour lives | **alias of `--network`** |

PR #71's aliasing silently adds network I/O to a flag that is read-only today.
main's source comment states the reasoning explicitly and refuses it.
Lane contract says: "Do not silently make `--deep` mutate, spend, or replace `--live`."

**Chosen contract:** main's. `--deep` stays a read-only alias of fast.
`--network` lands as a **new, explicitly-named** bounded network-inspection mode.
`configured` / `reachable` / `verified` stay distinct across all four modes.

### C3 — the diagnostics engine

| | current main | PR #71 |
| --- | --- | --- |
| shape | `diagnostics.ts` 476L, monolithic | `diagnostics.ts` to 35L re-export barrel over `src/core/diagnostics/*` (17 files, 1325L) |
| live proof | `doctor_live.ts` **991L** | `diagnostics/dev_session_live.ts` 154L |
| repair | `doctor_repair.ts` 378L | `diagnostics/repair.ts` 267L |

PR #71's *decomposition* is better than main's monolith. PR #71's *content* is
substantially thinner and older — its live engine is 15% the size of main's.

**Chosen contract:** keep main's engine content; adopt PR #71's module decomposition
as a follow-on refactor **only** once behaviour is proven equivalent (LOOP-13), not
as part of this rescue. PR #71's re-implementations of checks main already has
(`auth, backend, mcp, memory, persistence, runtime, tools, transport, workspace`)
are dropped as duplicates.

### C4 — what in PR #71 is genuinely new and must survive

Not superseded by anything on main. This is the payload the rescue exists for:

    src/core/skills/*            20 files — schema, digest, lock, trust, discovery,
                                 loader, resolver, policy, bounds, eval, session,
                                 settings, context packet, permission vocabulary
    src/core/instructions/*      3 files  — AGENTS.md discovery + resolver + provenance
    src/core/capabilities.ts     capability matrix
    src/commands/capabilities.ts `aether capabilities` + `/why`
    src/core/support_bundle.ts   redacted self-verifying bundle
    src/core/redaction.ts        + src/core/tar.ts + src/core/why_log.ts
    src/commands/skills.ts       `aether skills` CLI family
    src/skills/builtin/*         6 built-in skills + eval cases (18 asset files)
    scripts/copy-skill-assets.ts package asset copy
    src/core/diagnostics/skills.ts        NEW check — no main equivalent
    src/core/diagnostics/instructions.ts  NEW check — no main equivalent

`diagnostics/skills.ts` and `diagnostics/instructions.ts` bind to PR #71's
`CheckSpec` only thinly (`{id, category, mode, severity, repairId, run(deps)}`).
main's `DiagnosticCheckSpec` + `CheckOutcome` carries the same fields plus
`title` and `remediation`. The port is a shape translation, not a rewrite.

### C5 — additive surfaces worth keeping from PR #71

`--schema v2` JSON selection, `renderDoctorJUnit`, and `toV1Report` are useful and
have no main equivalent — but they are written against `DoctorReportV2`. They are
**deferred to PR A0.3** and must be re-targeted at `HealthReport`, or dropped.
They are not worth resurrecting the dead contract for.

## Resulting lane shape

Rebasing PR #71 as authored is the wrong move: it would land a second doctor v2,
a second wire contract under the same version number, and 9 duplicate checks.

Reconstruct instead, as a stack:

    PR A0.1  skill + instruction foundation          src/core/skills, src/core/instructions, tests
    PR A0.2  capabilities, doctor integration,       capabilities, support bundle, redaction, tar,
             repair and support bundle               why_log; skills+instructions checks ported
                                                     onto health.ts CheckOutcome
    PR A0.3  public CLI wiring and package assets    aether skills, /skills, capabilities cmd,
                                                     builtin assets, copy-skill-assets, docs

Net effect: PR #71's 100 files drop to roughly 60; the wire-contract collision
disappears; main's newer live/repair engine is preserved intact; PR #66's
media-history and safe-opener work is untouched.

## Findings

| id | severity | domain | evidence | description | status |
| -- | -------- | ------ | -------- | ----------- | ------ |
| A0-F1 | CRITICAL | contract | health.ts:16 vs diagnostics/contracts.ts:26 | Two incompatible payloads both declare doctor schema version 2 | contract chosen (C1) |
| A0-F2 | HIGH | false-green | diagnostics/contracts.ts:16-18 | `verified: boolean` cannot express not-checked; fast mode must then emit a value indistinguishable from checked-and-failed | contract chosen (C1) |
| A0-F3 | HIGH | compat | PR71 doctor.ts header vs main doctor.ts:5-7 | PR #71 silently repoints read-only `--deep` at network-performing `--network` | contract chosen (C2) |
| A0-F4 | MEDIUM | duplication | diagnostics/{auth,backend,mcp,memory,persistence,runtime,tools,transport,workspace}.ts | 9 checks re-implemented that main already has | drop as duplicates (C3) |
| A0-F5 | MEDIUM | regression-risk | doctor_live.ts 991L vs dev_session_live.ts 154L | Naive `theirs` resolution would silently replace main's live engine with a 6x thinner one | drop PR71 side (C3) |
| A0-F6 | HIGH | process | `gh pr view 71 --json statusCheckRollup` returns empty | PR #71 has **no CI at all**; its green status cannot be inherited | open |
| A0-F7 | MEDIUM | metadata | package.json repository/bugs point at `DBarr3/aether-agent` | Stale owner; canonical repo is `AetherAI3/aether-agent` | deferred to SC-INT |

## Tests executed

| command | result | commit | notes |
| ------- | ------ | ------ | ----- |
| `git merge --no-commit --no-ff a868f7d0` | conflict, 4 files | 41a7e26 | intake only; aborted, tree clean |

No build/typecheck/test gate has been run yet at this commit. Nothing is claimed green.

## Deferred items

* `--schema v2` / JUnit renderer re-targeted at `HealthReport` (PR A0.3 or dropped)
* Adopting PR #71's module decomposition for main's engine (LOOP-13, behaviour-equivalence-gated)
* `package.json` owner metadata (SC-INT)

## Merge dependencies

SC-A1 and SC-A5 must start from the accepted A0 integration head — both touch
`src/core/stream.ts`, which PR #71 also modifies.

## Recommended next loops

LOOP-06 (command truth for the reconciled doctor flag set), then LOOP-07
(support-bundle + package asset safety), then LOOP-11/12 on trust and redaction.
