# Operator packet — Aether Agent v0.3.0

Everything a founder needs to publish this release, and everything that was
proven before asking. Nothing in this packet was executed against the registry
or against a git ref: creating the tag, publishing the release, and publishing
to npm are founder-owned and are listed at the end, unrun.

| | |
|---|---|
| Package | `aether-agents` |
| Proposed tag | `v0.3.0` |
| Branch base | `85a75645e8b94e8542bcf6ee0f384037a2915a5e` (`origin/main`, after #106) |
| Release commit | the merge commit of this integration PR into `main` — **re-run the candidate on it before tagging** (§6.6) |
| Historical candidate | `fb96ee44b03f37a386954a32412728fa7e98a046` (PR-local evidence commit; historical only, not reachable from current `main`) |
| Historical archive | `aether-agents-0.3.0.tgz` — 739,977 bytes packed / 3,022,168 unpacked / 575 entries |
| Historical archive sha256 | `70a48aca8baa8b63f551980256eafa42531cd22fc5ca1146829d31f8b4bd2e4d` |
| Current exact-head dry run | 624 entries / 3,377,342 unpacked bytes / 4 workflows |
| Current dry-run predicted packed size | 797,672 bytes (inventory estimate; no archive was created) |
| Current archive | **PENDING — no exact-head archive has been produced** |
| Current archive sha256 | **PENDING — record only after producing that archive** |

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

Feature range `477f0fc..a845479` — 28 commits, 2026-08-19 08:39 EDT through
2026-08-22 21:48 EDT — plus everything the unpublished v0.2.0 notes described.
PR #96 then landed the release-owned notes, coherence gate and candidate tooling
as `84d8767`; PR #106 reconciled the package manifest as `85a75645`. Neither
commit added feature implementation to that range.

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

Per-PR detail: [`2026-08-22.md`](2026-08-22.md).

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
current tree has a 612-entry dry-run inventory, but no matching archive. Any lane that lands before
the tag is created moves the evidence again — which is why step 6 of §6 re-runs
the candidate on the merge commit rather than trusting a historical digest.
`test/release_coherence.test.ts` fails the build if a
user-visible command reaches the registry without either a release note or a
named exemption (§4), so the next lane to land cannot repeat this silently.

## 3. State of the world when this packet was written

Read live, 2026-08-22:

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
612-entry tree. Neither substitutes for the post-merge run required by §6.6.

### Current integration dry-run

On the integration tree, `verify:production` exited 0 and reported 612 entries,
3,292,404 unpacked bytes, and 4 workflows; the matching dry-run JSON predicted
797,672 packed bytes. This was an
`npm pack --dry-run` inventory. It did not produce `aether-agents-0.3.0.tgz`, so
the current archive size and sha256 are pending rather than borrowed from an
older candidate.

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

The exact-head dry run reported 624 entries and 3,377,342 bytes unpacked. Five
files are at the package root, four generated public documents are under `docs/`,
and everything else is under `dist/src/`. This is an inventory prediction, not
a statement that a current archive exists.

The AETHER-AGENT-LIVE-01 R2 Remote Control host (`/rc`) added four shipped
modules — `dist/src/commands/rc.*`, `dist/src/core/remote_host.*`,
`dist/src/core/remote_redaction.*`, and `dist/src/ui/qr.*` — i.e. 12 entries
(`.js` + `.d.ts` + `.js.map` each), which is what raised the prior 612-entry
integration-tree inventory to 624.

| Path | Entries |
|---|---:|
| `COMMANDS.md`, `LICENSE`, `NOTICE.md`, `README.md`, `package.json` | 5 |
| `docs/generated/**`, `docs/model-catalogue/**` | 4 |
| `dist/src/core/**` | 330 |
| `dist/src/ui/**` | 120 |
| `dist/src/commands/**` | 132 |
| `dist/src/skills/**` (six built-in skills) | 18 |
| `dist/src/generated/**` | 3 |
| `dist/src/{index,main,types,version}.*` | 12 |

By extension: 199 `.js`, 199 `.d.ts`, 199 `.js.map`, 14 `.json`, 11 `.md`, 1
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
  Until step 11 completes, `npm i -g aether-agents` installs `0.1.0`.
- **The full `npm test` suite inside the candidate run.** The release-candidate
  run executes the release-owned test files only and reports `npm-test` as
  `not-run`; `--full-tests` includes it. The suite *was* run separately on this
  machine at integration commit `b23c8b1` — 1543 tests, 1540 pass, 0 fail,
  3 skipped — and that reading is recorded in the PR body. It remains local
  evidence only; the final proposed head must repeat this proof in required CI.
- **Anything about the deployed API.** Two claims in the release notes'
  Authentication section describe a *server*, not this package: that the API
  accepts long-lived `aek_` tokens, and that `/auth/logout` actually ends the
  session. This repository has no live credential in CI and no test asserts
  either. They are marked in the notes as operator-verified, and they should be
  re-checked against production before the release is announced. What this lane
  can say is narrower: `npm run smoke` on this machine reached
  `https://api.aethersystems.net/cloud` and got an authenticated cloud turn
  back, which is consistent with the first claim and proves nothing about the
  second.
- **That `aether agent` works against production today.** #105 exists because
  it does not: `AETHER_AGENT_DEV_ENABLED` is unset on `api.aethersystems.net`,
  so a dev session is refused and — as of this release — the run now **exits 3**
  instead of silently becoming a chat. That is the correct behaviour and it is
  still a broken end-to-end path. It is a server configuration gap, not
  something this tag fixes.
- **A complete general-purpose headless agent driver.** `aether exec` is a safe
  `aether.exec/1` foundation with cancellation, receipts, authoritative
  verification, and a confined tool set. Resume, pause, steer, reusable agent
  definitions, and controller-mediated dogfood remain explicit follow-on work;
  unsupported controls fail closed rather than pretending to succeed.
- **The authoritative live public model fleet.** The generated catalogue is a
  sanitized, deterministic six-model preview sourced from public release notes.
  It labels unknown provider, modality, and availability values honestly; an
  additive public projection of the authoritative `/models` registry is still
  required before calling the live catalogue complete.
- **The Aether Online or Aether Code handoff.** The local preview lifecycle is
  implemented, but no durable owner/project/purpose-bound redemption nonce,
  hidden web intake, or deployed cross-worker store is present in this package.
  No client-only substitute may be treated as the Online bridge.
- **A current exact-head archive or digest.** The current evidence is a dry-run
  inventory only. The `70a48aca…` digest belongs to the historical 575-entry
  candidate and must not be compared as though it described the 612-entry tree.
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
   npm ci --ignore-scripts && npm run release:candidate -- --out rc-final.json
   ```

   Confirm `"ok": true` and `"commitBound": true`.

7. **Create the tag on that commit:**

   ```bash
   git tag -a v0.3.0 <merge-sha> -m "v0.3.0 — skills, and a release that matches the repository"
   git push origin v0.3.0
   ```

8. **Publish a GitHub release for `v0.3.0`**, body taken from
   [`2026-08-22.md`](2026-08-22.md). Publication — not tag creation — is what
   triggers `release.yml`.

9. **Confirm the prerequisites `release.yml` needs before publishing the
   release**, because a missing one fails the run after the release is already
   public:
   - the `npm-production` environment exists on the repository;
   - `NPM_TOKEN` is set in it (the workflow asserts the secret is non-empty
     before it publishes);
   - the workflow's `id-token: write` / `attestations: write` permissions are
     not restricted by an organisation policy.

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

12. **Only after step 11 succeeds**, update the availability language in
   `README.md` and `RELEASE_NOTES.md` to say 0.3.0 installs from npm. Until that
   proof exists, the repository must keep saying `npm i -g` gives you `0.1.0` —
   `test/release_coherence.test.ts` enforces that the claim cannot be added
   without the registry actually serving it.

## 7. Credentials

No Aether credential, npm token or GitHub token was used, read, or written by
the release-candidate run. `release.yml` reaches `NPM_TOKEN` only inside the
`npm-production` environment, and the checkout step sets
`persist-credentials: false` so no token is left in the runner's git config.
