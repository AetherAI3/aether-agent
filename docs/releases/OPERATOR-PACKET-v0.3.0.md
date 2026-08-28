# Operator packet — Aether Agent v0.3.0

Everything a founder needs to publish this release, and everything that was
proven before asking. Read-only registry and production probes are recorded
below. No tag, GitHub release, npm publication, or production configuration was
created or changed by those probes.

| | |
|---|---|
| Package | `aether-agents` |
| Proposed tag | `v0.3.0` |
| Original PR branch base | `85a75645e8b94e8542bcf6ee0f384037a2915a5e` (`origin/main`, after #106; historical) |
| Reconciled base/current main | `88b7498457afce482fa69363d908b0e8b3bd4ae9` (`origin/main`, after #111) |
| Pre-merge candidate head | `3cf44bb3f2fc2ae22cc40678209383de8a9f66ad` (PR #107 exact head; regenerate after merge) |
| Release commit | the merge commit of this integration PR into `main` — **re-run the candidate on it before tagging** (§6.6) |
| Historical candidate | `fb96ee44b03f37a386954a32412728fa7e98a046` (PR-local evidence commit; historical only, not reachable from current `main`) |
| Historical archive | `aether-agents-0.3.0.tgz` — 739,977 bytes packed / 3,022,168 unpacked / 575 entries |
| Historical archive sha256 | `70a48aca8baa8b63f551980256eafa42531cd22fc5ca1146829d31f8b4bd2e4d` |
| Current exact-head dry run | 618 entries / 4 workflows |
| GitHub-hosted Ubuntu value | 3,688,966 unpacked bytes — exact-head CI run `32967113102` passed |
| GitHub-hosted Windows value | 3,690,927 unpacked bytes — exact-head CI run `32967113102` passed |
| Current local Windows default-checkout measurement | 3,690,927 unpacked bytes / 836,234 predicted packed bytes |
| Current local Linux/LF checkout measurement | 3,688,966 unpacked bytes / 835,957 predicted packed bytes |
| Qualified pre-merge archive | `aether-agents-0.3.0.tgz` — 835,957 bytes packed / 3,688,966 unpacked / 618 entries at `3cf44bb...`; commit-bound candidate passed install, version, help, skills, capabilities, and handoff proof |
| Qualified pre-merge archive sha256 | `6176172deb15eea57519408d93f23b3fac8ab5e2b2e541adddc34b4e5fb4c33d` — regenerate on every new head and replace from the merge commit before tagging |
| Cloud catalogue compatibility | PR #1327 final head `70e0645c96b16dedfefb90dd403daecb3c3d3b25`; landed as squash merge `fbb7b98a96682820b85a4bface002dcbf5bf9c37`, tree `9906df6f73b6cd8d8e57e1e552475976394d617f`; safe-field projection digest `sha256:80ba3ba1144d301e2cca407ceced74cb2b371f1da6e3982b87305ff12a3d4712`. The package carries all 51 safe rows. On 2026-08-27 production `/cloud/healthz` reported deployed Cloud `c694c8805139`, and the live catalogue returned 51 rows, 48 available to the authenticated tier. |

## 1. Semantic version decision

**0.2.0 → 0.3.0 (minor).**

`main` contains a backwards-compatible feature addition that the v0.2.0 notes
never described: PR #72 added the skills runtime and three new CLI commands —
`aether skills`, `aether capabilities`, `aether support-bundle` — plus six
built-in skills shipped inside the package. Semver makes that a minor bump.

Reusing `0.2.0` was rejected. `0.2.0` is already the name of a specific, dated,
written-up artifact: the RELEASE_NOTES.md entry of 2026-08-19, the README's
availability paragraph, `install.sh`'s pin example, and a packed
`aether-agents-0.2.0.tgz` that lived in the repository root from #83 until #90
deleted it. That tarball predates the skills runtime entirely. Publishing a
different tarball under the same version would make two materially different
artifacts answer to one name — the identity defect this release exists to close.

`0.2.0` is retired unused. It will never be published.

## 2. What the release covers

The historical feature range `477f0fc..a845479` contains 28 commits from
2026-08-19 through 2026-08-22 plus everything the unpublished v0.2.0 notes
described. PR #96 then landed the release-owned notes, coherence gate and
candidate tooling as `84d8767`; PR #106 reconciled the package manifest as
`85a75645`. PR #107 adds the final product spine: generated command/model truth,
bounded local Ollama setup, versioned headless execution, managed preview, and
release-candidate hardening. The actual release range is `v0.1.0` through the
verified PR #107 merge commit, not the historical 28-commit slice alone.

- 4 feature waves: #72 (skills runtime and its three commands), #98
  (command-registration seam), #93/#94/#95/#97/#101/#102 (the review → commit →
  pull request rail, and the two commands that expose it), and #99
  (`aether sessions`) — plus #100, which is what finally puts skills and
  `AGENTS.md` inside a real run and enforces their tool policy.
- 13 user-visible fix commits: #73, #74, #75, #77, #78, #83, #84, #88, #89,
  #91, #103, #104, #105.
- 3 test-only commits: #82, #85, #87.
- 1 documentation/hygiene commit: #90.
- Product-spine additions after that historical range: `aether setup` and
  `aether local` carry explicit `changed` command dispositions, and their
  `ollama.local` requirement is `announced` in the current release notes.

Two of these carry **behaviour changes** — three changes in total, all named in
the "Behaviour changes" section of the release notes. #105 adds exit code 3 for
a run that refuses to degrade into a chat. #104 refuses a symlinked config
directory when writing the token, and reports a planted token link as "no
token" rather than throwing. An operator upgrading a scripted install should
read that section before this one.

Historical per-PR detail: [`2026-08-22.md`](2026-08-22.md). The publish-ready
user-facing body is [`RELEASE-BODY-v0.3.0.md`](RELEASE-BODY-v0.3.0.md).

**This range moved twice after the candidate was first cut, and that is the
normal case.** #98 was squash-merged to `main` while PR #96 was open; then the
review/ship rail, `aether sessions`, the skills wiring, the opener and token-store
fixes and finally #105 landed the same way. The notes and this packet were
regenerated against each new base rather than tagged against the old one. #96
then landed on `main`, and #106 corrected the stale 527-entry manifest that had
survived beside its 575-entry header. The current product-spine integration
worktree includes later release-truth, command-manifest, and bounded local/Ollama
lanes on top of that historical range. Those commits are not silently folded
into the old 28-commit count: review the actual merge-base-to-HEAD range. The
current tree has a 618-entry commit-bound pre-merge archive. Any lane that lands before
the tag is created moves the evidence again — which is why step 6 of §6 re-runs
the candidate on the merge commit rather than trusting a historical digest.
`test/release_coherence.test.ts` fails the build if a
user-visible command reaches the registry without either a release note or a
named exemption (§4), so the next lane to land cannot repeat this silently.

## 3. State of the world when this packet was written

Registry state re-read live on 2026-08-27:

```
$ npm view aether-agents versions --json
[
  "0.1.0"
]

$ npm view aether-agents dist-tags --json
{
  "latest": "0.1.0"
}

$ gh release list -R AetherAI3/aether-agent
(no output — zero releases)

$ git tag -l
frozen-seam-v1        -> 48e8be477b22d86136126f40328b2856a1a07d7f
v0.1.0                -> f11bfe6b6c09fd36956958873d9bf4ad941b0fb7
```

There is no `v0.2.0` tag. There is no GitHub release of any version. `0.1.0` is
the only version that has ever existed on npm.

## 4. Evidence

Reproduce with:

```bash
npm run release:candidate -- --out rc.json
```

That runs `.github/workflows/release.yml`'s sequence against a detached
`git worktree` of `HEAD`, before any tag exists: `npm ci --ignore-scripts` →
`npm audit --audit-level=high` → typecheck → build → tests → `verify:production
--tag v0.3.0` → `npm pack` → global install of **that tarball** into a clean
prefix → CLI proofs run from the installed package.

There are two evidence classes below. The current facts come from npm's
**dry-run inventory** of the checked-out product-spine candidate after the local
setup fix cycle; they do not describe an archive. This packet does not embed a
supposed self-referential commit id: committing the packet changes that id.
The archive digest and installed-CLI proof come from the **historical candidate**
at `fb96ee44b03f37a386954a32412728fa7e98a046`; they do not describe the current
618-entry tree. Neither substitutes for the post-merge run required by §6.6.

### Current integration dry-run

On the integration tree, `verify:production` exited 0 and reported 618 entries
and 4 workflows. Fresh clean platform-shaped candidate checkouts measured
3,688,966 unpacked bytes for Linux/LF and 3,690,927 for Windows/default.
Exact-head CI run `32967113102` confirmed both hosted platform values at
`3cf44bb3f2fc2ae22cc40678209383de8a9f66ad`. The local
Windows default checkout measured 3,690,927 unpacked / 836,234 predicted packed
bytes; the clean LF checkout on that same Node 24.18.0/npm 11.16.0 toolchain
measured 3,688,966 unpacked / 835,957 predicted packed
bytes. The membership is identical; byte totals are checkout/toolchain
observations and are not claimed to be cross-machine reproducible. These were
`npm pack --dry-run` inventories. They did not produce
`aether-agents-0.3.0.tgz`, so the current archive size and sha256 are pending
rather than borrowed from an older candidate.

Package and archive evidence attached to Agent head
`e8ea19245a47de180332b5e34d93d5988b2df767` is historical after the #112
transition-safe README change. It is not evidence for this candidate.

The complete top-level npm dry-run reports for the two clean checkout shapes
were:

```json
{"host":"Linux/LF","id":"aether-agents@0.3.0","name":"aether-agents","version":"0.3.0","size":835957,"unpackedSize":3688966,"shasum":"66021f08d961ddd7b9236ce56afc356a48a45997","integrity":"sha512-wkguCmwwWX0ZhY1ZISnYTqhAppwMNawBhXRZxPFErjW8kS4ltMcwd5L5KpNE+vpeOlLnQyuD+/v6+H1AKE3TnA==","filename":"aether-agents-0.3.0.tgz","entryCount":618,"bundled":[]}
{"host":"Windows/default","id":"aether-agents@0.3.0","name":"aether-agents","version":"0.3.0","size":836234,"unpackedSize":3690927,"shasum":"ee9a89bc55c749f238707dc51a9c2b07c1a72631","integrity":"sha512-tUPTKa0MZhSgUFSR368iXAMsdmQHHuKEeYWg3F88BVbXIPbj19snaDBdXpmFAQf3n1RwIhz+vAIP8TL+tmwIEw==","filename":"aether-agents-0.3.0.tgz","entryCount":618,"bundled":[]}
```

The npm-reported `shasum` and `integrity` values above are host-bound dry-run
metadata, not a claim that a current archive exists and not a substitute for
the pending archive SHA-256. The README refresh changes package bytes without
changing the 618-entry membership, which is why these measurements were
regenerated rather than inherited.

The current command surface also includes `aether preview
start|open|logs|status|stop` and `/preview`. It manages only an explicit argv or
an argv declared in the confined `.aether/preview.json` contract. Start shows
the command, working directory, filesystem, environment, and loopback-network
implications before requiring consent. An owner-private, one-use challenge
authenticates control; the local supervisor owns readiness, logs, status, stop,
and full process-tree cleanup. Stale PIDs are not
signalled, and headless runs print the ready URL without claiming a browser was
opened. This local capability does not relax `src/core/web.ts` SSRF policy.

### Historical candidate archive

The prior candidate report records commit
`fb96ee44b03f37a386954a32412728fa7e98a046`, `commitBound: true`, `ok: true`,
and process exit 0. That PR-local evidence commit is not present in the
reachable history of current `main`; the block is retained only as provenance
for the historical 575-entry archive it actually measured.

```
PASS     commit-identity — fb96ee44b03f37a386954a32412728fa7e98a046
PASS     stage-commit — detached worktree of that commit
PASS     npm-ci-ignore-scripts — found 0 vulnerabilities
PASS     npm-audit-high — found 0 vulnerabilities
PASS     typecheck — tsc --noEmit exit 0
PASS     build — copied 18 built-in skill assets → dist/src/skills/builtin
PASS     release-tests — 4 release test files, exit 0
NOT-RUN  npm-test — NOT RUN here — the full suite is release.yml's gate.
                    This report says nothing about it.
PASS     verify-production — {"ok":true,"package":"aether-agents","version":"0.3.0",
                             "packedFiles":575,"packedBytes":3022168,"workflows":3}
PASS     pack — aether-agents-0.3.0.tgz
                sha256:70a48aca8baa8b63f551980256eafa42531cd22fc5ca1146829d31f8b4bd2e4d
PASS     install-tarball — <prefix>/node_modules/aether-agents
PASS     installed --version — 0.3.0
PASS     installed --help — 49 lines, lists skills, capabilities, resume, agent, doctor
PASS     installed skills list — aether/frontend-from-screenshot@1.0.0 builtin enabled …
PASS     installed capabilities — instructions        unavailable (agent_skills_disabled)
PASS     installed demo:handoff — independent test run in machine-b/slugify: green

RELEASE CANDIDATE OK
```

The last five lines all ran the CLI that `npm install --global` placed on disk
from that historical tarball, in a clean prefix — not `dist/` in a source
checkout. They must not be presented as exact-head CLI evidence.

**The digest changed when the base moved, and that is the point.** This packet
has now recorded three historical digests for the same version number:
`25f33524…` at `a63e1c6e` over 524 entries, `8c5c119d…` at `426b124` over 527,
and `70a48aca…` for the PR-local `fb96ee44…` candidate over 575. Each lane that
landed genuinely changed the packed content — #98 added the dispatch table,
#93–#102 added the review/ship rail, #99 the session library, #105 the routing
guard — so the digest moved with it. A digest that had survived those changes
would have meant the pack was not reading the tree.

The historical `70a48aca…` digest belongs only to the 575-entry archive in the
candidate block. The current dry run has more entries and no archive, so
there is no honest digest to compare with it yet. The packet itself remains
outside the tarball: the `files` allowlist is `dist/src`, the four generated public
documents, README, COMMANDS, LICENSE, and NOTICE; `docs/releases/` remains excluded.

None of these figures is a cross-machine reproducibility claim (see §5), and
none is the digest a founder should tag against: §6.2 re-runs the candidate on
the merge commit, because any lane landing before the tag moves this number
again.

On the current documentation-hardening head, `npm run typecheck` and
`npm run docs:check` exit 0; the focused command-manifest, generated-docs,
public-docs, release-truth, release-coherence, and production-hardening set
reports 65 pass / 0 fail; and `release:truth` reports
12/12 pass with no unavailable or not-applicable lane. The older 1464-test
result belonged to the historical candidate context and is not presented as
current exact-head evidence. The full suite remains a required release workflow
gate.
The local-lane namespace, pull, config, session, handoff, command-manifest, and
release-coherence selection independently reported 98 pass / 0 fail before
integration; exact-head integration proof is rerun below before handoff.

### Historical mutation check on the load-bearing gate

`test/release_coherence.test.ts` asserts that every feature the release notes
promise has its code inside the file list `npm pack` would ship. To show that
gate is real, `"!dist/src/commands/skills.js"` was added to the `files`
allowlist, which silently drops `aether skills` from the tarball:

```
production manifest + pack validators -> no errors, 574 files    MISSED IT
release_coherence -> 2 FAIL: packet measurement changed, and
                              dist/src/commands/skills.js is missing
                              (agent skills runtime — `aether skills`)
```

Restored: 575 packed files, 12/12 pass. The pre-existing production gate does not
catch a dropped feature, because it does not know what the notes promised.

### Current dry-run packaged file manifest

The exact-head candidate dry runs reported 618 entries on clean Linux/LF and
Windows/default checkouts. Exact-head CI confirmed their 3,688,966 and
3,690,927 unpacked-byte results on the corresponding hosted platforms;
local default and LF checkouts measured 3,690,927 and 3,688,966 respectively
because byte totals can move with checkout line
endings and toolchain metadata. Five files are at the package root, four
generated public documents are under `docs/`, and everything else is under
`dist/src/`. This is an inventory prediction, not a statement that a current
archive exists.

| Path | Entries |
|---|---:|
| `COMMANDS.md`, `LICENSE`, `NOTICE.md`, `README.md`, `package.json` | 5 |
| `docs/generated/**`, `docs/model-catalogue/**` | 4 |
| `dist/src/core/**` | 327 |
| `dist/src/ui/**` | 117 |
| `dist/src/commands/**` | 132 |
| `dist/src/skills/**` (six built-in skills) | 18 |
| `dist/src/generated/**` | 3 |
| `dist/src/{index,main,types,version}.*` | 12 |

By extension: 197 `.js`, 197 `.d.ts`, 197 `.js.map`, 14 `.json`, 11 `.md`, 1
`.html`, 1 extensionless. Source maps ship, as they did in 0.1.0; that is
existing policy, unchanged by this release.

No compiled tests, no `.env`, no `.tgz`, no `dist/scripts`. `verify-production`
rejects each of those by name and the pack report above confirms their absence.

### Commands that ship without a release note

Gate B above runs notes → package: a claim with no code behind it fails. The
inverse — a user-visible command that ships with **no claim anywhere in the
notes** — is the direction that actually keeps happening, and it happened to this
very release while its PR was open (#98). `release_coherence` now enforces both
directions: every visible command in the CLI registry must be announced by some
release note, or named here with a reason.

These 15 commands ship in 0.3.0 without a release note. All predate the release
log or were announced by capability rather than by command token in an earlier
entry. **None of them is new in this release:**

`aether help`, `aether chat`, `aether run`, `aether agents`, `aether github`,
`aether vault`, `aether workflow`, `aether memory`, `aether image`,
`aether video`, `aether output`, `aether audit`, `aether receipt`, `aether mcp`,
`aether config`.

Two changes since the candidate was first cut, both made by the gate rather
than by hand:

- **`aether auth` left the list.** The v0.3.0 notes now carry an Authentication
  section naming `aether auth login` and `aether auth logout`, so it is
  announced, and the list refuses to keep an exemption for a command that is.
- **`aether output` joined it.** It was never announced by command token; it was
  covered by the 2026-08-14 entry as "durable media output history". It only
  became visible here because the announcement matcher was tightened (below).

The six commands this release DOES add — `aether review`, `aether ship`,
`aether sessions`, the already-announced `aether doctor`, and the product-spine
`aether setup` / `aether local` surfaces — are all announced
in the v0.3.0 entry, so none of them appears above.

`login` and `logout` are exempt by rule: the registry marks them `hidden`, so
they are not surfaced in `aether --help` and there is no surface to announce.

The list is enforced in both directions — a stale entry fails, and an entry that
*is* announced fails — so it cannot rot into a permanent bypass that quietly
absorbs the next unannounced command. **If a lane lands a new command before the
tag is cut, the build fails until it is either announced or added here.**

#### The announcement matcher was vacuous, and is not any more

Worth reading before trusting the list above. The matcher counted a command as
announced if the notes contained its name in bare backticks *anywhere*. When
#102 landed `aether review` and `aether ship`, the gate passed both of them
immediately — not because they were announced, but because the notes mention the
built-in **skills** named `review-pr` and `ship`. The gate built to catch an
unannounced command would have let the two headline commands of this release
through in silence.

It now requires the form a user actually types, `aether <name>`. A test asserts
the matcher rejects `review-pr` as an announcement of `review` and `` `ship` ``
as an announcement of `ship`, so this cannot regress into coverage that is not
there. Tightening it is what surfaced `aether output`.

#### Mutation check on the inverse gate

A command was added to the CLI registry and mentioned nowhere:

```
{ name: "teleport", args: "<dest>", summary: "beam the working tree somewhere",
  section: "System" }

release_coherence -> FAIL: no user-visible command ships without either a
                     release note or a named exemption
                     + [ 'teleport — beam the working tree somewhere' ]
                     - []
```

The production manifest and pack validators reported no errors at 575 files and
3,022,363 unpacked bytes. `release_coherence` failed the unannounced `teleport`
command. Removed: 12/12 pass, and the restored package returned byte-for-byte
to 3,022,168 unpacked bytes.

## 5. What is NOT proven

Named as unproven rather than omitted:

- **npm availability of 0.3.0.** Nothing here contacted the registry to publish.
  Until step 11 completes, describe an unversioned install as following the
  registry's live `latest` dist-tag; do not hard-code which version that tag
  selects.
- **The full `npm test` suite inside the candidate run.** The release-candidate
  harness intentionally reports `npm-test` as `not-run` unless `--full-tests`
  is supplied. The exact PR #107 head was therefore qualified separately:
  1,618 tests, 1,615 pass, 0 fail, 3 documented Windows skips locally, with the
  same head passing the required Ubuntu and Windows CI jobs. The merge commit
  must repeat this proof before tagging.
- **Logout semantics on the deployed API.** The authenticated exact-head smoke
  reached `https://api.aethersystems.net/cloud` and received a cloud turn, and
  `/cloud/healthz` reported `c694c8805139`. The release can therefore claim
  authenticated reachability, not that `/auth/logout` was independently
  exercised during this release.
- **That `aether agent` works against production today.** #105 exists because
  it does not: `AETHER_AGENT_DEV_ENABLED` is unset on `api.aethersystems.net`,
  and the 2026-08-27 doctor canary returned HTTP 403. No session was created,
  UVT and cents stayed at zero, and no orphan remained. A coding run is refused
  and — as of this release — the run now **exits 3**
  instead of silently becoming a chat. That is the correct behaviour and it is
  still a broken end-to-end path. It is a server configuration gap, not
  something this tag fixes.
- **A production-hosted headless driver.** `aether exec` ships the local
  `aether.exec/1` and `/2` foundations with checkpoints, acknowledged controls,
  confined definitions, receipts, and authoritative verification. The Cloud
  driver remains unavailable while production DevSessions are disabled;
  unsupported hosted control stays closed.
- **A live catalogue guarantee.** The package carries a sanitized 51-row dated
  projection with explicit availability semantics. Production also returned 51
  safe rows during qualification, but the packaged snapshot is not a promise
  that provider availability cannot change after publication.
- **The Aether Online or Aether Code handoff.** Cloud PR #1329 landed a
  default-off owner-bound redemption contract, but this package exposes no
  supported public handoff command and no activated production intake was
  qualified. No client-only substitute is treated as the Online bridge.
- **A merge-commit archive or digest.** The current 618-entry archive is bound
  to pre-merge PR head `3cf44bb...`; it proves the candidate, not the future
  merge commit. The release workflow must regenerate it after merge.
- **Reproducibility of an archive digest across machines.** Once the exact-head
  archive exists, its digest is a machine reading to compare with CI, not a
  promise that another machine must produce byte-identical gzip bytes.
- **`npm audit` against future advisories.** The audit result is a reading taken
  at pack time, not a standing property.

## 6. Pre-merge gates and founder-owned actions

The local evidence above is not merge authority. Neither `AA-REL-01` nor this
integration created a tag, published a release, or contacted the registry to
publish. The following pre-merge gates remain blocking and must be attached to
the exact proposed head rather than inferred from an ancestor or a workstation:

1. **Resolve every independent-review finding** and rerun the full suite,
   release truth, generated-document check, installed-tarball verification, and
   adversarial mutation coverage on the resulting clean commit.

2. **Publish a draft branch and obtain required exact-head CI evidence** on both
   Linux and Windows. Required checks must include the full suite and an install
   and launch of the exact packed artifact outside the source tree.

3. **Run real Predator CI against the exact proposed head.** This repository has
   no configured Predator client or recorded Predator result today; absence is
   a blocking dependency, not a passing or not-applicable check.

4. **Complete the final independent review** after CI and Predator evidence are
   available, resolve its threads, and verify that no unrelated generated or
   scratch artifacts entered the package.

5. **Founder: merge the approved integration PR to `main`.** Note the merge
   commit SHA; the tag must point at it, and `release.yml` refuses to publish a
   tag that is not an ancestor of `origin/main`.

6. **Re-run the candidate on the merge commit**, so the tag is created against
   evidence for the exact commit being tagged:

   ```bash
   git fetch origin main && git checkout <merge-sha>
   npm ci --ignore-scripts && npm run release:candidate -- --out rc-final.json --full-tests
   ```

   Confirm `"ok": true` and `"commitBound": true`.

7. **Create the tag on that commit:**

   ```bash
   git tag -a v0.3.0 <merge-sha> -m "v0.3.0 — skills, and a release that matches the repository"
   git push origin v0.3.0
   ```

8. **Publish a GitHub release for `v0.3.0`**, body taken from
   [`RELEASE-BODY-v0.3.0.md`](RELEASE-BODY-v0.3.0.md). Publication — not tag
   creation — is what triggers `release.yml`. Do not use the historical
   2026-08-22 candidate record as the public release body.

9. **Confirm the prerequisites `release.yml` needs before publishing the
   release**, because a missing one fails the run after the release is already
   public:
   - the `npm-production` environment exists on the repository;
   - `NPM_TOKEN` is set in it (the workflow asserts the secret is non-empty
     before it publishes);
   - the workflow's `id-token: write` / `attestations: write` permissions are
     not restricted by an organisation policy.

   Live check on 2026-08-27: `npm-production` exists and requires owner review,
   but no `NPM_TOKEN` repository or environment secret is visible and local npm
   is unauthenticated. Publishing the GitHub release before that credential is
   installed would expose the release and then fail npm publication.

10. **Watch the `Release npm package` workflow.** It re-runs the whole sequence on
   the tag, attests provenance, uploads the tarball plus a CycloneDX SBOM as a
   90-day artifact, and only then runs `npm publish --provenance`.

11. **Verify availability from the registry, not from the workflow log:**

   ```bash
   npm view aether-agents versions --json      # must now include 0.3.0
   npm view aether-agents dist-tags --json     # latest must be 0.3.0
   ```

   Record the exact archive's sha256 in this packet, then compare it with the
   workflow artifact. Do not use the historical `70a48aca…` digest as the
   expected digest for the current tree.

12. **Only after step 11 succeeds**, add a dated release record stating that
   0.3.0 was observed on npm. Keep the README's unversioned install wording
   transition-safe: it follows the registry's live `latest` dist-tag and tells
   readers how to inspect that tag. Do not replace it with a hard-coded version
   that can become false during a publish transition.

## 7. Credentials

No Aether credential, npm token or GitHub token was used, read, or written by
the release-candidate run. `release.yml` reaches `NPM_TOKEN` only inside the
`npm-production` environment, and the checkout step sets
`persist-credentials: false` so no token is left in the runner's git config.
