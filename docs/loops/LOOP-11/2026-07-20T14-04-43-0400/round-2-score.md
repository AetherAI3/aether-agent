# Round 2 re-attack and score

| criterion | result | evidence |
|---|---|---|
| Block-scalar lifecycle bypass | KILLED | negative fixture reports missing `--ignore-scripts` |
| Quoted/global/npx installer bypass | KILLED | quoted and npx negative fixtures fail policy |
| Exact package execution | PASS | isolated global install, binary existence, version and help |
| Release authorization | PASS | release event only, protected environment, version binding, main ancestry |
| Supply-chain identity | PASS | full-SHA actions, least permissions, provenance and attestation |
| External controls | UNKNOWN, EXPLICIT | L07-007 remains operator-deferred |

Round score: 92 / 100
Verdict: PASS
Final confidence: 0.90
