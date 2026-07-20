# Invocation trace

| node/track | role | reasoning summary | tools used | duration | confidence | result |
|---|---|---|---|---|---:|---|
| rounds 1-8 | breaker | Attack release authorization, workflow parser coverage, artifact executability, dependency execution, and installer injection. | read, static scan, tests | bounded session | 0.90 | 3 BROKE / 5 HELD |
| rounds 1-3 | builder | Fix root causes and add permanent negative regression coverage. | edit, npm test, package smoke | bounded session | 0.92 | PASS |
| convergence 1-8 | referee | Reclassify novel vs variant, verify branch isolation and final-zero trend. | queue analysis | bounded session | 0.90 | CONVERGED |
