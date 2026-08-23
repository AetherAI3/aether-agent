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

## Closure implementation snapshot

Recorded at `2026-08-23T20:03:30Z`. Cloud `main` was
`478033bb531d2f165b930b142193d76802256a49` at this snapshot; its newest commit
touches only Desktop login handling. The Cloud PRs remain based on the live
`main` branch and mergeable. Their lane commits last incorporated
`main@1ad05d8e8815758012466f6f83df9835498207c0`; hosted pull-request checks
exercise GitHub's live merge ref and supersede local base-only observations.

| Lane | Exact implementation state | Qualification at this snapshot |
| --- | --- | --- |
| C1 | Real production preflight against the intake head; no substitute added | Blocked on owner/security Predator assurance-profile onboarding. Any later Agent head requires a new real run. |
| C2 | Draft [Cloud PR #1324](https://github.com/AetherAI3/AETHER-CLOUD/pull/1324), head `9886de21f946cccb92c1969b465a232b2a37d572` | 146 curated doctor/capability tests and the OpenAPI snapshot pass; Ruff and diff checks pass. No staging or production probe has run. |
| C3 | Draft [Cloud PR #1329](https://github.com/AetherAI3/AETHER-CLOUD/pull/1329), head `0c5612dd65a3b65927c566aaf2497fa333ce9bfc` | 22 backend/API/migration/OpenAPI tests, seven browser intake tests, site typecheck, targeted ESLint, Ruff, and diff checks pass. Feature remains default-off and no migration or deployment has been applied. |
| C4 | Integrated locally into the Agent spine through `c7d3087294db35229ff4f1392e95a938edcaf8e0` | `aether.exec/2` controls/checkpoints and the hosted text-model driver pass focused gates. The driver requires an exact model and positive UVT cap, rejects Aether orchestrator IDs, validates the server model, and keeps tool authority local. Actual Neo/Kronus controller dogfood remains open because Cloud has no orchestrator dev-session contract. |
| C5 | Agent manifest/catalogue integration plus draft [Cloud PR #1327](https://github.com/AetherAI3/AETHER-CLOUD/pull/1327), head `1bb984068f8065f8dce579108f21faa8eda8c8c6` | Agent command/generated-reference gates pass. Cloud projection/API/OpenAPI tests and Ruff pass. Product-policy approval of the public projection is pending. |
| C6 | Integrated locally into the Agent spine | All ten adversarial classes are covered; preview suite passes 15/15. An unrelated pre-existing ready URL now fails before child spawn, and denied PID probing no longer abandons a live owner. |
| C7 | Agent changes remain local; remote [PR #107](https://github.com/AetherAI3/aether-agent/pull/107) intentionally remains draft at `121d98dba19823766bc34d71aedc388b74836fd2` | Withheld by the prescribed order: Cloud PR review/landing, staging proof, owner production canaries, exact-head Predator, and independent F0 precede integration-branch publication or release mutation. |

### Exact local Agent qualification before the final closure commit

- Full test matrix through the prior integration checkpoint: 1,574 passed,
  two stale-evidence assertions failed, and three expected skips. Both stale
  assertions were corrected; their focused reruns pass.
- `npm run smoke`: four passed and three environment-dependent skips. The
  Cloud turn passed; local Ollama was unavailable and is not counted as proof.
- `npm run verify:production`: passed with 618 packed files and 3,669,584
  unpacked bytes.
- `npm pack --dry-run`, `npm run docs:check`, and `npm run release:truth` pass.
- Headless cloud/dev/drift tests pass 35/35; headless v1/v2 tests pass 29/29;
  manifest/generated-doc/release gates pass 64/64; final public-doc subset
  passes 34/34.

The mandatory full Agent matrix must run again after this register commit.
Results are valid only for that resulting exact local head. The branch remains
unpublished until the Cloud rollout dependencies above are satisfied.

### Falsified actual-Aether shortcut

The live registry exposes `aether-neo-5.1t` and `aether-kronus-v2.4`, but the
current Cloud development-session path resolves both router IDs to `sonnet`.
The exact orchestrator endpoint executes server-side and has no Agent-compatible
local tool-result, receipt, replay, or control contract. The Agent driver
therefore rejects all current Aether orchestrator IDs before network access;
claiming that path as Neo/Kronus dogfood would be false.

Closing C4 dogfood requires a versioned Cloud orchestrator development session
that confirms the exact router, emits session-correlated local tool calls and
durable receipts, supports pause/resume/steer/cancel and replay, and never falls
back to server execution. Only then can a positive-UVT, owner-authorized
packaged controller canary satisfy the actual-Aether gate.

### Rollout dependencies still requiring authority or external state

1. Owner/security onboards the real Predator assurance profile.
2. Cloud reviewers approve and land the three draft PRs in C2, C3, then C5
   order; the C5 public projection receives explicit product-policy approval.
3. An authorized operator deploys staging, applies the reviewed C3 migration,
   and runs doctor/redemption E2E with Protocol-C, zero-unexpected-UVT, and
   zero-orphan evidence.
4. An authorized owner runs the bounded production doctor, redemption, hosted
   inference, and eventual actual-Aether controller canaries.
5. Vercel's account-wide build-rate quota clears or an authorized owner changes
   the plan; this is separate from repository tests.
6. Only after those gates may the local Agent spine be published to PR #107,
   receive fresh CI/CodeQL/SBOM/Predator evidence, enter F0, and proceed toward
   draft removal, merge, tag, npm publication, or rollout.

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
