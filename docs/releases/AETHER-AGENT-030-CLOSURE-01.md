# Aether Agent 0.3.0 closure control register

Control id: `AETHER-AGENT-030-CLOSURE-01`

This register extends the existing Supercluster release graph. It does not
create a second release DAG. The Agent integration spine remains
[PR #107](https://github.com/AetherAI3/aether-agent/pull/107), and Cloud work
lands independently in `AetherAI3/AETHER-CLOUD` before dependent Agent
consumers are admitted.

## Immutable intake checkpoint

| Field | Value |
| --- | --- |
| Recorded at | 2026-08-23T16:56:54Z |
| Agent repository | [`AetherAI3/aether-agent`](https://github.com/AetherAI3/aether-agent) |
| Integration branch | `codex/product-spine-integration` |
| Integration head | `121d98dba19823766bc34d71aedc388b74836fd2` |
| Base | `main@85a75645e8b94e8542bcf6ee0f384037a2915a5e` |
| PR state | draft, mergeable, clean |
| Historical test result | 1,556 passing, zero failures, three expected skips |
| Historical checks | [CI](https://github.com/AetherAI3/aether-agent/actions/runs/32650220748), [CodeQL](https://github.com/AetherAI3/aether-agent/actions/runs/32650220728) |
| Cloud authoritative base | `main@6e8188a4d959ae71ecfd12fae02d79019ffa360b` |

The historical evidence above is valid only for `121d98d...`. Any Agent head
change invalidates its CI, CodeQL, review, Predator, package, and release
evidence. Any Cloud head or deployment change invalidates its contract,
staging, canary, UVT, orphan-session, and Protocol-C evidence.

## Initial closure register

Requested non-GPT model pools were not callable in this controller runtime.
They are not represented as completed work. Actual Aether model execution
remains a mandatory C4 acceptance gate and cannot be replaced by a mock or a
GPT-authored claim.

| Lane | Model / owner | Repository and branch | Scope and file lease | Dependencies | Permission and budget | Acceptance gate |
| --- | --- | --- | --- | --- | --- | --- |
| C0 | GPT frontier / root controller | Agent `codex/030-c0-control` from `121d98d...` | Register, evidence invalidation, leases, merge queue, final integration | none | read/write repository; no merge, release, deploy, or publication | Exact-head register and dependency-safe merge train remain current |
| C1 | GPT-5.6 Sol / Predator investigator; root controls external gate | Agent `codex/030-c1-predator` from `121d98d...`; production Predator owner plane is in Cloud | Real Predator only; no substitute scanner or badge | final Agent head, approved assurance profile, owner authorization | non-spending preflight/quote permitted; no profile minting or paid run without authority | Commit-bound real Predator artifacts and policy approval on final head, merged main, and release commit |
| C2 | GPT-5.6 Sol / Cloud doctor owner | Cloud `codex/030-c2-doctor-contract` from `6e8188a...` | `lib/agent_dev` doctor-purpose validation and exact compatibility tests | authoritative Cloud base; exact Agent doctor body | Cloud code/tests; no deployment or production canary | Authenticated zero-inference, zero-UVT doctor contract; ordinary `max_uvt=0` remains rejected |
| C3 | queued GPT frontier worker after C2 | separate Cloud branch from then-current authoritative main | Durable Agent-to-Code/Web redemption, migration, hidden consumer, audit, rollback | C2 shape review; existing durable Supercluster CAS primitive | Cloud code/tests; feature disabled or owner-only; no deployment | Atomic owner/project/purpose/target-bound redemption; replay and cross-scope refusals; cancellation/expiry/delegation proof |
| C4 | GPT-5.6 Sol / headless owner | Agent `codex/030-c4-headless` from `121d98d...` | Headless protocol, durable session/control state, model forwarding, tests; exclusive lease | C2 deployed for real hosted path; actual Aether model access | Agent code/tests; bounded dogfood only; no publication | v1 compatibility plus honest v2 controls, exact terminal semantics, process-tree cancellation, packaged real-model dogfood |
| C5 | queued GPT frontier worker after C6 | separate Agent branch from exact integration parent | Command metadata authority and sanitized versioned Cloud catalogue projection | Cloud public projection contract; C4 public commands | Agent/Cloud code and generated docs; no invented live catalogue | Runtime handlers reconcile to manifest; docs/help/slash derive from it; digest/staleness/offline projection tests pass |
| C6 | GPT-5.6 Sol / preview hardening owner | Agent `codex/030-c6-preview` from `121d98d...` | Preview command, contract, supervisor, adversarial tests; exclusive lease | none | local process/network tests only; loopback; no external deployment | All ten chaos cases pass, including transient-unreachable identity preservation and private Unix directories |
| C7 | GPT frontier / root controller | PR #107 plus separate Cloud PRs | Cross-repository merge train, staging/canary evidence, final matrices and rollback points | C1-C6 | integration and CI writes allowed; production mutation, merge, tag, publish, deploy, and draft removal require their stated gates/authority | Ordered Cloud then Agent rollout with exact final-head evidence |
| F0 | fresh frontier reviewer, reserved and read-only | exact final Agent and Cloud heads | Independent reconstruction from raw evidence; authors no patch | C1-C7 complete or externally adjudicated | read-only | Exactly `APPROVED`, `CHANGES_REQUIRED`, or `BLOCKED_EXTERNAL` |

## Live dependency queue

1. C2 Cloud contract and C3 disabled redemption contract land as separate Cloud
   PRs against authoritative main.
2. Staging contract proof and an authorized production doctor canary precede
   any Agent consumer of the Cloud contracts.
3. C4, C5, and C6 land as narrow dependent changes into PR #107. Agent `open`
   remains excluded until the deployed C3 contract is proven.
4. The integration branch is updated against current Agent main, then the full
   source, package, launcher, docs, release-truth, SBOM, CodeQL, Protocol-C,
   Ollama, headless, and preview matrices are regenerated.
5. Real Predator runs on that exact head. A new commit burns the approval.
6. F0 reviews raw final evidence. Draft removal, merge, merged-main proof,
   release construction, tag, npm publication, and rollout follow only in the
   authorized order.

## Current external control

Authenticated, non-spending production Predator preflight for
`AetherAI3/aether-agent@121d98dba19823766bc34d71aedc388b74836fd2`
returned `support=onboarding_required`, `reason=no_matching_profile`,
`nextAction=request_profile`, and `profile=null` at
2026-08-23T16:56:44.712868Z. The matching quote failed closed with HTTP 422
`repository_not_supported` at 2026-08-23T16:56:54.184150Z.

This is a security-policy authority dependency, not an implementation excuse:
the real production Predator system is callable, but an authorized owner must
approve the repository's assurance profile before any qualifying run can
start. No local profile, threshold change, or substitute scanner may close C1.

## Evidence and rollback rules

- Evidence must name repository, base, head, command or workflow, conclusion,
  and durable URL or CI artifact. A workstation path is never release evidence.
- A green result without an exact commit binding is informational only.
- Cloud migrations require a reviewed down migration or an explicit forward
  rollback plan before staging.
- Cloud feature activation must retain a disabled/owner-only kill switch.
- Agent integration rollback is a normal revert of the narrow lane commit; it
  must not rewrite PR history.
- npm publication is irreversible. Publication is withheld until merged-main,
  fresh-package, Predator, and F0 gates are complete and authorized.
