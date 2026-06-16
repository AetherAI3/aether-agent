# Spec: Rename to `aether-agent` + first npm publish

**Date:** 2026-06-08
**Repo:** `aether-code` (to be renamed `aether-agent`)
**Status:** Approved design — ready for implementation plan

---

## Problem

`npm i -g aether-code` installs a **squatter's package**, not ours.

The public npm name `aether-code` is owned by an unrelated party:

| Field | Public npm `aether-code` | Ours |
|---|---|---|
| Maintainer | `rivendaddy <dannyshtansky0161@gmail.com>` | Brandon Barrante (Aether AI LLC) |
| Repo | `github.com/dannyphantomx64/aether-code` | `github.com/DBarr3/aether-code` (private) |
| Homepage | `https://trynoguard.com` | `aethersystems.net` |
| License | MIT | Apache-2.0 |
| Description | "Uncensored AI coding agent… No refusal layer" | ours |
| Created | 2026-05-08, latest 0.12.0 (2026-05-18) | never published |

Root cause (two facts, both true):
1. We **never published** `aether-code` to npm (`npm whoami` → `ENEEDAUTH`).
2. The unscoped name `aether-code` was registered first by a third party.

Consequence: repo visibility is irrelevant. `npm i -g aether-code` resolves to the
squatter regardless of whether our repo is public or private. Our own README
(`README.md:10`, `:31`, `:147`) currently directs every user to that command — i.e.
**our install instructions point users at the squatter today.** The "cloud terminal"
the user saw on install was the squatter's own CLI (also a Claude-Code-alternative
agent), not our software. `trynoguard` appears **zero times** in our source.

## Decision

Move off the contested name entirely. Publish under the clean, available unscoped name
**`aether-agent`** (verified AVAILABLE on npm, 2026-06-08). Out-execute the squatter —
no registry dispute. Keep a parked abuse-report draft in-repo for optional later use.

Rationale: npm names are first-come-first-served, not trademark-governed by default.
Aether AI LLC alone is weak leverage without a registered trademark, and `aether` is a
semi-generic word. `aether-agent` is clean, ours instantly, and arguably clearer (it is
an agent). Not worth blocking launch on a name fight.

## Scope

### In scope
1. **Package identity** (`aether-code/package.json`)
   - `name`: `aether-code` → `aether-agent`
   - `bin`: drop `aether-code`; keep `aether` (primary) + add `aether-agent` (alias).
     Both → `dist/src/main.js`.
   - `repository.url`, `bugs.url` → `DBarr3/aether-agent`
   - `homepage`: unchanged (`aethersystems.net`)
   - `version`: `0.1.0` (first publish)
2. **GitHub repo rename** `DBarr3/aether-code` → `DBarr3/aether-agent` (auto-redirects).
   Update local git remote. *(human-gated)*
3. **README / docs fix — this repo**
   - `README.md:10`, `:31` install commands → `aether-agent`
   - `README.md:147` import example → `from "aether-agent"`
   - Sweep `COMMANDS.md`, `CONTRIBUTING.md`, `install.ps1`, `install.sh` for install/name
     strings → `aether-agent`
   - **Preserve** the `aether code` *subcommand* and `aether` command name everywhere
     (skills, memory, internal UX depend on it). Only the **install name** and **package
     import path** change.
   - Review `src/*.ts` + `assets/aether_code_console.html` hits individually: update
     package-name/import strings; leave brand wordmark + `aether code` subcommand text.
4. **README fix — `aethercloud` repo**
   - `README.md:10`, `:84`, `:96` and `PRICING.md:4` → repointed link
     `github.com/DBarr3/aether-agent` (display text may stay "Aether Code" as product
     name, but URL must follow the rename).
5. **First npm publish**
   - `npm login` under Aether AI npm account *(human-gated)*
   - `npm publish` (public)
   - **Verify gate:** clean-shell `npm i -g aether-agent` → `aether --version` and
     `aether-agent --version` both run our build, not the squatter's.
6. **Parked abuse-report draft** — one Markdown file in-repo
   (`docs/npm-abuse-report-draft.md`) citing impersonation + "uncensored agent →
   trynoguard.com" + Aether AI LLC. Not filed; reference for if/when a trademark exists.

### Out of scope
- Filing any npm dispute / trademark application (future, user-driven).
- Renaming the `aether` CLI command or the `aether code` subcommand.
- Website (`aethersystems.net/download`) changes — separate deploy; flag only.
- Any change to backend, billing, or auth.

## Components & data flow

No runtime architecture change. This is a packaging + naming change:

```
user → npm i -g aether-agent → npm registry (our published tarball)
     → global bin `aether` / `aether-agent` → dist/src/main.js (unchanged behavior)
```

The only behavioral guarantee that matters: the installed bin executes **our**
`dist/src/main.js`, verified by the post-publish smoke test.

## Testing

- `npm run build` green.
- `npm pack --dry-run` → tarball contains `dist/`, README, COMMANDS.md, LICENSE,
  NOTICE.md; `bin` map shows `aether` + `aether-agent`, no `aether-code`.
- Existing `node --test` suite green (no logic changed).
- Post-publish: fresh shell, `npm i -g aether-agent`, run `aether --version` +
  `aether-agent --version`; confirm both resolve to our code (e.g. correct version
  string / homepage), not the squatter.

## Risks

- **Bin collision:** if a user has both the squatter's package and ours, both expose
  `aether`. Mitigated by the `aether-agent` alias (collision-proof fallback).
- **GitHub rename link rot:** GitHub auto-redirects old slug, but `aethercloud` links are
  updated explicitly so we don't depend on the redirect.
- **Human-gated steps** (`npm login`, repo rename, publish) block full automation — plan
  must stop and hand off at each.

## Open / deferred
- Website `/download` + funnel copy still say `aether-code` install — deferred to a
  separate web deploy task; flagged, not done here.
- Trademark filing — out of scope; would re-open the dispute option later.
