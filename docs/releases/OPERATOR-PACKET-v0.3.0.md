# Operator packet — Aether Agent v0.3.0

Everything a founder needs to publish this release, and everything that was
proven before asking. Nothing in this packet was executed against the registry
or against a git ref: creating the tag, publishing the release, and publishing
to npm are founder-owned and are listed at the end, unrun.

| | |
|---|---|
| Package | `aether-agents` |
| Proposed tag | `v0.3.0` |
| Branch base | `426b12464c2a19549f421adb43348f83d028628e` (`origin/main`, after #98) |
| Release commit | the merge commit of this PR into `main` — **re-run the candidate on it before tagging** (§6.2) |
| Evidence commit | `22aa02141fba158927cb1f01e4344cfa3e8f1a01` |
| Tarball | `aether-agents-0.3.0.tgz` |
| Tarball sha256 | `8c5c119d93cabf49af0c49c97addb055308d508af93f8675a26b6f5c8ecba307` |
| Tarball size | 597,400 bytes packed / 2,459,474 unpacked |
| Packed entries | 527 |

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

Commit range `477f0fc..426b124` — 17 commits, 2026-08-19 08:39 EDT through
2026-08-22 11:12 EDT — plus everything the unpublished v0.2.0 notes described.

- 2 feature commits: #72 (skills runtime and its three commands) and #98
  (command-registration seam), the second of which also carries three
  user-visible fixes.
- 10 user-visible fix commits: #73, #74, #75, #77, #78, #83, #84, #88, #89, #91.
- 3 test-only commits: #82, #85, #87.
- 1 unwired module: #86 (ship rail; no command invokes it, so it changes no
  behaviour in this release).
- 1 documentation/hygiene commit: #90.

Per-PR detail: [`2026-08-22.md`](2026-08-22.md).

**This range moved after the candidate was first cut.** #98 was squash-merged to
`main` while PR #96 was open, and the notes were updated to cover it. Any lane
that lands before the tag is created moves it again — which is why step 2 of §6
re-runs the candidate on the merge commit rather than trusting this packet's
digest. `test/release_coherence.test.ts` fails the build if a user-visible
command reaches the registry without either a release note or a named exemption
(§4), so the next lane to land cannot repeat this silently.

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

Recorded run — commit `22aa02141fba158927cb1f01e4344cfa3e8f1a01`, `commitBound:
true`, `ok: true`, process exit 0:

```
PASS     commit-identity — 22aa02141fba158927cb1f01e4344cfa3e8f1a01
PASS     stage-commit — detached worktree of that commit
PASS     npm-ci-ignore-scripts — found 0 vulnerabilities
PASS     npm-audit-high — found 0 vulnerabilities
PASS     typecheck — tsc --noEmit exit 0
PASS     build — copied 18 built-in skill assets → dist/src/skills/builtin
PASS     release-tests — 4 release test files, exit 0
NOT-RUN  npm-test — NOT RUN here — the full suite is release.yml's gate.
                    This report says nothing about it.
PASS     verify-production — {"ok":true,"package":"aether-agents","version":"0.3.0",
                             "packedFiles":527,"packedBytes":2459474,"workflows":3}
PASS     pack — aether-agents-0.3.0.tgz
                sha256:8c5c119d93cabf49af0c49c97addb055308d508af93f8675a26b6f5c8ecba307
PASS     install-tarball — <prefix>/node_modules/aether-agents
PASS     installed --version — 0.3.0
PASS     installed --help — 46 lines, lists skills, capabilities, resume, agent, doctor
PASS     installed skills list — aether/frontend-from-screenshot@1.0.0 builtin enabled …
PASS     installed capabilities — instructions        supported
PASS     installed demo:handoff — independent test run in machine-b/slugify: green

RELEASE CANDIDATE OK
```

The last five lines all ran the CLI that `npm install --global` placed on disk
from that exact tarball, in a clean prefix — not `dist/` in a source checkout.

**The digest changed when the base moved, and that is the point.** An earlier
candidate at `a63e1c6e` — before #98 was on `main` — produced
`25f33524bd866275674eccbf8cfe5706f14e925cb0ba35861dc6bc21a9245a2d` over 524
entries. #98 added `dist/src/core/command_dispatch.*` and rewrote `main.js`, so
the packed content is genuinely different and the digest is too. A digest that
had survived that change would have meant the pack was not reading the tree.

Neither figure is a cross-machine reproducibility claim (see §5), and neither is
the digest a founder should tag against: §6.2 re-runs the candidate on the merge
commit, because any lane landing before the tag moves this number again.

Independently, `npm run typecheck` exits 0 and the release-owned test files —
`version`, `release_coherence`, `release_canaries`, `production_hardening` —
report 24 pass / 0 fail.

### Mutation check on the load-bearing gate

`test/release_coherence.test.ts` asserts that every feature the release notes
promise has its code inside the file list `npm pack` would ship. To show that
gate is real, `"!dist/src/commands/skills.js"` was added to the `files`
allowlist, which silently drops `aether skills` from the tarball:

```
verify:production  ->  {"ok":true, ... "packedFiles":526}          MISSED IT
release_coherence  ->  FAIL: dist/src/commands/skills.js
                             (agent skills runtime — `aether skills`)
```

Restored: 527 packed files, 10/10 pass. The pre-existing production gate does not
catch a dropped feature, because it does not know what the notes promised.

### Packaged file manifest

527 entries, 2,459,474 bytes unpacked. Five files at the package root, everything
else under `dist/src/` — the allowlist is `dist/src` plus four documents, and
nothing else reaches a user.

| Path | Entries | Size |
|---|---:|---:|
| `COMMANDS.md`, `LICENSE`, `NOTICE.md`, `README.md`, `package.json` | 5 | — |
| `dist/src/core/**` | 273 | 1305.8 KiB |
| `dist/src/ui/**` | 111 | 331.2 KiB |
| `dist/src/commands/**` | 105 | 648.5 KiB |
| `dist/src/skills/**` (six built-in skills) | 18 | 21.7 KiB |
| `dist/src/generated/**` | 3 | 15.0 KiB |
| `dist/src/{index,main,types,version}.*` | 12 | 25.7 KiB |

By extension: 168 `.js`, 168 `.d.ts`, 168 `.js.map`, 13 `.json`, 9 `.md`, 1
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
log or were announced by capability rather than by command token in the June 2026
entry. None of them is new in this release:

`aether help`, `aether chat`, `aether run`, `aether agents`, `aether auth`,
`aether github`, `aether vault`, `aether workflow`, `aether memory`,
`aether image`, `aether video`, `aether audit`, `aether receipt`, `aether mcp`,
`aether config`.

`login` and `logout` are exempt by rule: the registry marks them `hidden`, so
they are not surfaced in `aether --help` and there is no surface to announce.

The list is enforced in both directions — a stale entry fails, and an entry that
*is* announced fails — so it cannot rot into a permanent bypass that quietly
absorbs the next unannounced command. **If a lane lands a new command before the
tag is cut, the build fails until it is either announced or added here.**

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

`verify:production` reported `ok:true` throughout. Removed: 9/9 pass.

## 5. What is NOT proven

Named as unproven rather than omitted:

- **npm availability of 0.3.0.** Nothing here contacted the registry to publish.
  Until step 6 completes, `npm i -g aether-agents` installs `0.1.0`.
- **The full `npm test` suite on this machine.** The release-candidate run
  executes the release-owned test files only and reports `npm-test` as
  `not-run`. The whole suite is `release.yml`'s gate and CI's reading is the
  authority. Run `npm run release:candidate -- --full-tests` to include it.
- **Reproducibility of the tarball digest across machines.** The digest below is
  what this machine produced. It is recorded so the CI-built tarball can be
  compared against it, not asserted to be byte-identical on other hosts.
- **`npm audit` against future advisories.** The audit result is a reading taken
  at pack time, not a standing property.

## 6. Founder-owned actions

These are the only remaining steps, and none of them were run from this lane.
`AA-REL-01` created no tag, published no release, and contacted no registry.

1. **Merge this PR to `main`.** Note the merge commit SHA; the tag must point at
   it, and `release.yml` refuses to publish a tag that is not an ancestor of
   `origin/main`.

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
