# TypeScript 7 terminal upgrade

**Branch:** `feat/typescript-7-terminal-upgrade`
**Status:** Implemented and verified on PR #49
**Date:** 2026-07-20
**Scope:** Whole repository

## Purpose

Move Aether Agent from the JavaScript TypeScript 5 compiler to the stable
TypeScript 7 native compiler. The migration must preserve application and wire
behavior while making the faster compiler, stronger checks, and cleaner public
package the repository defaults.

The implementation follows the official TypeScript 7 release guidance:
<https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>.

## Compatibility inventory

- TypeScript 7 defaults `types` to an empty list. This Node application must
  explicitly declare `types: ["node"]` or every Node global and built-in import
  disappears from the type environment.
- TypeScript 7.0 does not expose the old compiler API. This repository never
  imports `typescript`, so it can use the native compiler directly without a
  TypeScript 6 compatibility alias.
- The existing `NodeNext` module and resolution settings are supported. They
  stay explicit to preserve emitted ESM behavior and package paths.
- Node 24 is the actual project floor: `package.json` and CI already required
  it because the test runner uses `--test-isolation=none`. README, contributor,
  and installer claims that still said Node 20 were stale.
- `exactOptionalPropertyTypes` was evaluated but intentionally not enabled in
  this behavior-preserving migration. Enabling it would require changing the
  presence of optional fields across stream, brain, and transport wire objects.

## Repository-wide implementation

### Toolchain and compiler contract

- Pin `typescript` to `^7.0.2` and align `@types/node` to `^24.0.0`.
- Explicitly load Node types and reject emit on type errors.
- Enable checks for unused locals and parameters, implicit returns, switch
  fallthrough, side-effect imports, index-signature property access, and
  verbatim ESM imports.
- Add `npm run typecheck` and a migration guard test so the TypeScript 7, Node
  24, zero-runtime-dependency, ESM, and publish-surface contracts cannot drift.

### Behavior-preserving cleanup

- Remove dead imports, a dead password-prompt helper, write-only animation
  state, an unused storyboard prompt constant, and unused type declarations.
- Replace five CommonJS `require(...)` calls hidden in the ESM application with
  static ESM imports. Those paths compiled before the migration but failed when
  interactive media, workflow brainstorming, context purge, rollback, or
  revert commands executed.
- Replace remaining application-level `any` annotations in touched paths with
  concrete types or narrowed `unknown` values.
- Replace the broken direct-source dev command with a fast TypeScript 7 build
  followed by the compiled CLI. This keeps development runtime-dependency-free.

### Public repository and npm surface

- Remove the unused `tsx` runtime dependency and its transitive `esbuild`
  packages. The application again has zero runtime dependencies.
- Publish only `dist/src` instead of all `dist`, excluding compiled tests from
  the npm tarball.
- Correct the documented library import to the published package name,
  `aether-agents`, and align every public Node requirement to Node 24.
- Remove internal cleanup notes, a misspelled internal source map, operator and
  agent-loop execution artifacts, an obsolete package-dispute design, and an
  unfiled npm abuse-report draft containing third-party contact details and
  allegations. None belong in the current tree of a public repo.

## Measured result

Measurements were taken on the same Windows checkout and machine. TypeScript
5.9.3 used three warm builds; TypeScript 7.0.2 used five warm builds.

| Measurement | Before | After | Change |
|---|---:|---:|---:|
| Warm `npm run build` average | 4,465.8 ms | 1,328.9 ms | 3.36x faster / 70.2% less time |
| Full `npm test` wall time | 15,246.9 ms | 10,726.5 ms | 29.6% less time |
| npm packed size | 520,197 bytes | 382,610 bytes | 26.4% smaller |
| npm unpacked size | 2,346,626 bytes | 1,616,677 bytes | 31.1% smaller |
| npm audit | 1 low finding | 0 findings | clean |

Timing is machine-specific; the committed compiler and package-surface changes
are deterministic.

## Verification gates

- Clean install: `npm ci`
- Compiler identity: `tsc --version` reports `7.0.2`
- Strict typecheck: `npm run typecheck`
- Full suite on the local runtime and Node 24
- CLI development smoke: `npm run dev -- --help`
- Runtime smoke: no failures; network, sign-in, and local Ollama checks may skip
  when those external services are unavailable
- npm audit: zero vulnerabilities
- npm pack dry run: runtime files present, compiled tests absent
- PowerShell and POSIX installer syntax checks
- Current-tree scan for credentials, personal paths, and removed internal
  artifacts

## Non-goals

- No auth/401 UX work from `fix/terminal-auth-401-ux`.
- No production hardening work from `loop/devops-production-hardening`.
- No wire-format or optional-property shape changes.
- No TypeScript 7 nightly or TypeScript 7.1 compiler API dependency.
