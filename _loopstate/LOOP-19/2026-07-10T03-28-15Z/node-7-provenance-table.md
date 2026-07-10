# LOOP-19 · Node 7 — Provenance Table

Every synthesized element traces to the candidate element(s) and the arena entry that earned it. No element without an accepted arena lineage.

| element | source candidate element(s) | accepting arena entry | notes |
|---------|----------------------------|----------------------|-------|
| E1 registry (help/did-you-mean/completer source) | I1.4 + I3.5 + I1.8 (invariant) | MUT-3.1, MUT-2.3 accepted; AT-3c (registry gap + /quit drift) | convergent I1/I3 element, credited both |
| E2 splash honesty | I1.2 | MUT-3.1 accepted (derive-from-registry form); AT-1a survived as rider | pinned test updated in-weld |
| E3 errTheme + dim reasoning | I3.7 + new (attack-derived) | AT-1c accepted → graft; arbiter overrule of Adv-3's I3.7 drop (reason dissolved by errTheme) | fixes pre-existing stderr ANSI leak |
| E4 version single source | I1.1 | AT-1a "invisible" accepted-partial; kept as trivial rider | lockstep test added |
| E5 kaomoji single table | I1.6 | AT-1a accepted-partial; kept as trivial rider | byte-identical asserted |
| E6 auth/login vocabulary | I1.10 | AT-1a accepted-partial; kept as rider | no test pins these strings (verified) |
| E7 red [ FAIL ] / red ✗ | I1.3 | AT-1c accepted → stdout writes theme, stderr writes errTheme | first host_render test added |
| E8 COMMANDS.md truth | I1.12 | AT-1a (docs class) — kept, docs-only | |
| E9 real readline (history/completer/prompt) | I3.1 + MUT-2.5 (history file as storage) | MUT-2.5 accepted; AT-3b mitigations bound into design | non-TTY bytes unchanged |
| E10 turn cancellation + goodbye | I3.3 + I1.9 | MUT-2.1, MUT-3.3 accepted; AT-3d mitigations (signal into postJson; run.ts change documented) | |
| E11 thinking pulse + stall honesty | I3.2 + I2.6 (stall concept only) | MUT-3.2 accepted | the only IDEA-2 runtime element that survived |
| E12 error hints | I3.4 | MUT-1.1, MUT-2.2 accepted | pure fn in errors.ts |
| E13 typo guard (narrowed) | I1.5 (as narrowed by Adv-1 concession) | AT-1b accepted → narrowed form only; escape hatch corrected to `aether chat <word>` | severable |
| E14 run summary + unverified hint | I3.6 + I1.7 | MUT-2.4 accepted; AT-3e consolidation | surfaces buried failing count; --no-log fix |
| E15 (stretch) paste burst-batching | none (attack-derived) | AT-3a accepted (hazard) → synthesized mitigation | if unshipped → register R6 |

Consistency check: 15/15 elements have an accepting arena entry. Zero untraceable elements.
