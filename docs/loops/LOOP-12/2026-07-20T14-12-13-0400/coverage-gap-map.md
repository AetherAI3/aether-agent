# Coverage gap map

| file | line | branch | function | priority | note |
|---|---:|---:|---:|---|---|
| `scripts/verify-production.ts` | 90.69% | 55.68% | 100.00% | P1 | All production guard functions and success path covered; remaining lines are defensive malformed-tool/error branches and CLI argument errors |
| Workflow YAML | policy-tested | variant-tested | n/a | P1 | Full-SHA, timeout, permission, lifecycle, release, ancestry, and install-smoke invariants |
| Installers | static + parser | negative variants | n/a | P1 | Pipe-to-shell, version injection, hidden exit status, lifecycle execution |

Scope line coverage clears the 80% LOOP-12 gate. Branch coverage is recorded,
but this loop's declared quantitative gate is line coverage.
