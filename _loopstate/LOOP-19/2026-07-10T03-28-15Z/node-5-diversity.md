# LOOP-19 · Node 5 — Diversity Gate

Threshold: 0.75 (pairwise similarity must be BELOW). Checklist method: pair must differ on ≥2 of 3 axes (approach / cost-risk profile / scope).

| pair | approach | cost-risk | scope | est. similarity | verdict |
|------|----------|-----------|-------|-----------------|---------|
| I1 ↔ I2 | string/import-level polish of existing surfaces VS new subsystems (keys/line_editor/surface) + alt-screen rewiring | ~9.75h trivial-low VS 63-84h medium-high | static output honesty/consistency incl. docs VS whole-app unification incl. resume | ~0.10 | **PASS** (3/3 differ) |
| I2 ↔ I3 | structural unification, new files, raw-mode ownership VS thin additions at existing seams (readline opts, one-line hints) | 63-84h medium-high VS 9.5h low | REPL+code+resume, new interaction model VS minute-one felt pain in the existing model | ~0.10 | **PASS** (3/3 differ) |
| I1 ↔ I3 | output honesty/consistency (strings, colors, docs, truthful advertising) VS interaction mechanics (input recall, latency feedback, cancellation, actionable errors) | ~9.75h trivial-low VS ~9.5h low — **SAME** | breadth across all static surfaces VS depth on the live loop only | ~0.35 | **PASS** (2/3 differ) |

Convergent element noted (not a restatement): both I1.4 and I3.5 propose slash did-you-mean (I3 adds tab-completion; I1 adds the top-level typo guard I5). Treated as independent confirmation of value; provenance will credit both.

All three candidates admitted to the arena. No regeneration required.
