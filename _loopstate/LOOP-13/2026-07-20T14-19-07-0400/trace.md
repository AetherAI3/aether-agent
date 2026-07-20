# LOOP-13 trace

| node | role | action | evidence | result |
|---:|---|---|---|---|
| 1 | architect | Capture descriptive first-run target from docs, entrypoints, and graph | 128 nodes, 424 edges, architecture docs | complete |
| 2 | drift scanner | Analyze boundaries, SCCs, depth, and layer direction | one type-level SCC, zero confirmed layer violations | complete |
| 3 | surface archaeologist | Scan exact ten-line windows, dynamic entries, exports, and test-only callers | three duplicate families, one suspected-dead surface | complete |
| 4 | complexity analyst | Parse function branches, degrees, depth, inheritance, and file size | 1,306 functions, 88 over 10, one >800 file | complete with cognitive/call graph unmeasured |
| 5 | scorer | Apply documented formulas using LOOP-07/12 and node evidence | composite 72.3 over four scored axes | complete |
| 6 | historian | Create first trend row and initial delta | baseline established | complete |
| 7 | Forensic Architect | FREE-MAD attack on circular baseline, dead claims, score inflation, deltas, and unknowns | two rounds | PASS-WITH-BASELINE-DEBT, confidence 0.90 |

The analysis used no runtime mutations. Temporary analyzer dependencies were
installed outside the repository under the projectless workspace's `work/`
area and are not part of the deliverable.
