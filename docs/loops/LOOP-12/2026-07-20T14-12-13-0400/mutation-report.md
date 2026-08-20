# Mutation report

Mutation target: `scripts/verify-production.ts`
Method: apply one source mutation, build, run the nearest named test, require a
non-zero test result, then restore the exact source before the next mutant.

| mutant | mutation | killing test | result |
|---|---|---|---|
| M1 | invert version/tag equality | release manifest binds the tag | KILLED |
| M2 | disable zero-runtime-dependency rejection | release manifest contract | KILLED |
| M3 | disable full-SHA action rejection | workflow floating-action negative | KILLED |
| M4 | invert job timeout parity | workflow unbounded-job negative | KILLED |
| M5 | disable npm-ci lifecycle guard | block-scalar npm-ci negative | KILLED |
| M6 | disable manual publishing-dispatch rejection | publishing workflow negative | KILLED |
| M7 | disable curl-to-shell detection | installer pipe-to-shell negative | KILLED |
| M8 | disable npm/npx lifecycle detection | quoted and npx negatives | KILLED |
| M9 | invert installed CLI version comparison | exact packed CLI smoke | KILLED |
| M10 | invert maximum unpacked package size | valid package fixture | KILLED |

Score: **10 / 10 = 100%**. No equivalent mutants were excluded. The catalog is
stratified over the highest-risk release, dependency, workflow, installer, and
artifact-integrity guards; it is not claimed as exhaustive mutation of every
operator in the file.
