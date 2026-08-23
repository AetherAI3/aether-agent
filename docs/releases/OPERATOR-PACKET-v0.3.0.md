# Operator packet — Aether Agent v0.3.0

Everything a founder needs to publish this release, and everything that was
proven before asking. Nothing in this packet was executed against the registry
or against a git ref: creating the tag, publishing the release, and publishing
to npm are founder-owned and are listed at the end, unrun.

| | |
|---|---|
| Package | `aether-agents` |
| Proposed tag | `v0.3.0` |
| Branch base | `84d8767da341ac7305fd9156bdfb3bdbdde4f614` (`origin/main`, after #96) |
| Release commit | the merge commit of this repair PR into `main` — **re-run the candidate on it before tagging** (§6.2) |
| Last packet-embedded candidate | `fb96ee44b03f37a386954a32412728fa7e98a046` (ancestor of #96; final-head evidence belongs on the PR and must be re-run after merge) |
| Tarball | `aether-agents-0.3.0.tgz` |
| Tarball sha256 | `70a48aca8baa8b63f551980256eafa42531cd22fc5ca1146829d31f8b4bd2e4d` |
| Tarball size | 739,977 bytes packed / 3,022,168 unpacked |
| Packed entries | 575 |

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
as `84d8767`; it added no feature implementation to that range.

- 4 feature waves: #72 (skills runtime and its three commands), #98
  (command-registration seam), #93/#94/#95/#97/#101/#102 (the review → commit →
  pull request rail, and the two commands that expose it), and #99
  (`aether sessions`) — plus #100, which is what finally puts skills and
  `AGENTS.md` inside a real run and enforces their tool policy.
- 13 user-visible fix commits: #73, #74, #75, #77, #78, #83, #84, #88, #89,
  #91, #103, #104, #105.
- 3 test-only commits: #82, #85, #87.
- 1 documentation/hygiene commit: #90.

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
then landed on `main`; this repair corrects the stale 527-entry manifest that
survived beside the final 575-entry header. Any lane that lands before the tag
is created moves the evidence again — which is why step 2 of §6 re-runs the
candidate on the merge commit rather than trusting this packet's digest.
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

Last packet-embedded run — commit `fb96ee44b03f37a386954a32412728fa7e98a046`,
`commitBound: true`, `ok: true`, process exit 0. This is the measured ancestor
whose package bytes are unchanged by this packet because `docs/` is excluded;
it is not a substitute for the final-head and post-merge runs required below.

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
from that exact tarball, in a clean prefix — not `dist/` in a source checkout.

**The digest changed when the base moved, and that is the point.** This packet
has now recorded three different digests for the same version number, one per
base: `25f33524…` at `a63e1c6e` over 524 entries, `8c5c119d…` at `426b124` over
527, and `70a48aca…` at the head that merges `a845479` over 575. Each lane that
landed genuinely changed the packed content — #98 added the dispatch table,
#93–#102 added the review/ship rail, #99 the session library, #105 the routing
guard — so the digest moved with it. A digest that had survived those changes
would have meant the pack was not reading the tree.

One thing the digest is deliberately insensitive to: **this packet is not in the
tarball.** The `files` allowlist is `dist/src` plus README, COMMANDS, LICENSE and
NOTICE, so `docs/` ships to nobody and writing this number down here cannot
change it. That is why the digest above, measured at the evidence commit, still
describes the commit that records it.

None of these figures is a cross-machine reproducibility claim (see §5), and
none is the digest a founder should tag against: §6.2 re-runs the candidate on
the merge commit, because any lane landing before the tag moves this number
again.

Independently, `npm run typecheck` exits 0 and the release-owned test files —
`version`, `release_coherence`, `release_canaries`, `production_hardening` —
report 26 pass / 0 fail. The full suite is 1464 tests: 1460 pass, 0 fail, 4
skipped.

### Mutation check on the load-bearing gate

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

### Packaged file manifest

575 entries, 3,022,168 bytes unpacked. Five files at the package root, everything
else under `dist/src/` — the allowlist is `dist/src` plus four documents, and
nothing else reaches a user.

| Path | Entries | Size |
|---|---:|---:|
| `COMMANDS.md`, `LICENSE`, `NOTICE.md`, `README.md`, `package.json` | 5 | — |
| `dist/src/core/**` | 303 | 1595.4 KiB |
| `dist/src/ui/**` | 117 | 400.5 KiB |
| `dist/src/commands/**` | 117 | 831.9 KiB |
| `dist/src/skills/**` (six built-in skills) | 18 | 21.7 KiB |
| `dist/src/generated/**` | 3 | 15.0 KiB |
| `dist/src/{index,main,types,version}.*` | 12 | 27.7 KiB |

By extension: 184 `.js`, 184 `.d.ts`, 184 `.js.map`, 13 `.json`, 9 `.md`, 1
extensionless. Source maps ship, as they did in 0.1.0; that is existing policy,
unchanged by this release.

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

The four commands this release DOES add — `aether review`, `aether ship`,
`aether sessions`, and the already-announced `aether doctor` — are all announced
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
  Until step 6 completes, `npm i -g aether-agents` installs `0.1.0`.
- **The full `npm test` suite inside the candidate run.** The release-candidate
  run executes the release-owned test files only and reports `npm-test` as
  `not-run`; `--full-tests` includes it. The suite *was* run separately on this
  machine at the evidence commit — 1464 tests, 1460 pass, 0 fail, 4 skipped —
  and that reading is recorded in §4 and in the PR body. It is a local reading:
  `release.yml` and the PR's required checks are the authority.
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
- **Reproducibility of the tarball digest across machines.** The digest below is
  what this machine produced. It is recorded so the CI-built tarball can be
  compared against it, not asserted to be byte-identical on other hosts.
- **`npm audit` against future advisories.** The audit result is a reading taken
  at pack time, not a standing property.

## 6. Founder-owned actions

These are the only remaining steps, and none of them were run from this lane.
Neither `AA-REL-01` nor this repair created a tag, published a release, or
contacted the registry to publish.

1. **Merge this repair PR to `main`.** Note the merge commit SHA; the tag must
   point at it, and `release.yml` refuses to publish a tag that is not an
   ancestor of `origin/main`.

2. **Re-run the candidate on the merge commit**, so the tag is created against
   evidence for the exact commit being tagged:

   ```bash
   git fetch origin main && git checkout <merge-sha>
   npm ci --ignore-scripts && npm run release:candidate -- --out rc-final.json
   ```

   Confirm `"ok": true` and `"commitBound": true`.

3. **Create the tag on that commit:**

   ```bash
   git tag -a v0.3.0 <merge-sha> -m "v0.3.0 — skills, and a release that matches the repository"
   git push origin v0.3.0
   ```

4. **Publish a GitHub release for `v0.3.0`**, body taken from
   [`2026-08-22.md`](2026-08-22.md). Publication — not tag creation — is what
   triggers `release.yml`.

5. **Confirm the prerequisites `release.yml` needs before publishing the
   release**, because a missing one fails the run after the release is already
   public:
   - the `npm-production` environment exists on the repository;
   - `NPM_TOKEN` is set in it (the workflow asserts the secret is non-empty
     before it publishes);
   - the workflow's `id-token: write` / `attestations: write` permissions are
     not restricted by an organisation policy.

6. **Watch the `Release npm package` workflow.** It re-runs the whole sequence on
   the tag, attests provenance, uploads the tarball plus a CycloneDX SBOM as a
   90-day artifact, and only then runs `npm publish --provenance`.

7. **Verify availability from the registry, not from the workflow log:**

   ```bash
   npm view aether-agents versions --json      # must now include 0.3.0
   npm view aether-agents dist-tags --json     # latest must be 0.3.0
   ```

   Compare the published tarball's sha256 with the digest in this packet and
   with the workflow artifact's.

8. **Only after step 7 succeeds**, update the availability language in
   `README.md` and `RELEASE_NOTES.md` to say 0.3.0 installs from npm. Until that
   proof exists, the repository must keep saying `npm i -g` gives you `0.1.0` —
   `test/release_coherence.test.ts` enforces that the claim cannot be added
   without the registry actually serving it.

## 7. Credentials

No Aether credential, npm token or GitHub token was used, read, or written by
the release-candidate run. `release.yml` reaches `NPM_TOKEN` only inside the
`npm-production` environment, and the checkout step sets
`persist-credentials: false` so no token is left in the runner's git config.
