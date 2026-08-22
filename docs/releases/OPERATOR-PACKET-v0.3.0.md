# Operator packet — Aether Agent v0.3.0

Everything a founder needs to publish this release, and everything that was
proven before asking. Nothing in this packet was executed against the registry
or against a git ref: creating the tag, publishing the release, and publishing
to npm are founder-owned and are listed at the end, unrun.

| | |
|---|---|
| Package | `aether-agents` |
| Proposed tag | `v0.3.0` |
| Branch base | `ed094dc8885945e69f66e166e854142005bf1d62` (`origin/main`) |
| Release commit | PENDING — the merge commit of this PR into `main` |
| Evidence commit | PENDING |
| Tarball | PENDING |
| Tarball sha256 | PENDING |
| Packed entries | PENDING |

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

Commit range `477f0fc..ed094dc` — 16 commits, 2026-08-19 08:39 EDT through
2026-08-20 07:47 EDT — plus everything the unpublished v0.2.0 notes described.

- 1 feature commit: #72.
- 9 user-visible fixes: #73, #74, #75, #77, #78, #83, #84, #88, #89, #91.
- 3 test-only commits: #82, #85, #87.
- 1 unwired module: #86 (ship rail; no command invokes it, so it changes no
  behaviour in this release).
- 1 documentation/hygiene commit: #90.

Per-PR detail: [`2026-08-22.md`](2026-08-22.md).

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

PENDING — evidence table filled from the recorded run.

### Packaged file manifest

PENDING

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
