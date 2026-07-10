# LOOP-19 · Node 1 — Ingest & Scope

- **run-id:** 2026-07-10T03-28-15Z
- **seed:** "Aether agent mega improvement patch — review the UX/UI, propose changes in a brainstorming debate cycle, implement the wins that can be ratcheted. Improve the overall coding experience, terminal usage, anything noticeable in UX/UI."
- **operator authorization:** implementation explicitly requested ("don't stop, make this a meaningful patch") — the execution agent is this same session; ratchet wins land as commits on the loop branch. Merge/push remain operator-only.
- **branch:** `loop/LOOP-19-2026-07-09` (from `codex/loop-35` @ 9585ba9)
- **baseline harness:** `npm test` → 122/122 pass, 0 fail (re-derived this run; LOOP-18 node-1 requirement satisfied)

## Goal statement

Converge on ONE synthesized UX/UI improvement plan for aether-code's terminal experience
(interactive REPL, `aether code` run surface, subcommand output), with full provenance,
then implement its ratchet-able elements as isolated, test-verified commits.

## Hard constraints

| id | constraint | source |
|----|-----------|--------|
| C1 | Bridge protocol FROZEN (v2) — presentation-layer changes only, no wire/event changes | docs/CONTRACTS.md, docs/BRIDGE_PROTOCOL.md |
| C2 | Non-TTY / `--json` / `NO_COLOR` / `AETHER_NO_ANIM` output stays plain & machine-clean (§8 emission logs) | docs/TESTING_HANDOFF.md, src/ui/theme.ts, status_renderer.ts |
| C3 | Ratchet discipline: one isolated change per commit; `npm test` green before every weld; behavior changes carry regression tests | LOOP-18 |
| C4 | Loop branch only; no merge, no push, no dispatch without operator review | LOOP-19 approval gates |
| C5 | Zero new runtime dependencies (repo is intentionally dependency-free; devDeps only) | package.json |
| C6 | Preserve the product identity (kaomoji personality, Aether cyan, honest liveness) — refine, don't erase | README/host_render/heartbeat comments |
| C7 | Swarm stays gated; do not touch the swarm guard | docs/SWARM_PLAN.md, code.ts |

## Candidate forced angles (structural divergence)

| candidate | forced angle | constraint profile |
|-----------|-------------|--------------------|
| idea-1 | **Safest incremental**: consistency & honesty polish of existing surfaces; no new subsystems | lowest risk, respects every current architectural seam |
| idea-2 | **Most ambitious / highest ceiling**: unify the terminal experience around the orphaned TuiLayout full-screen stack; one coherent live app | highest ceiling, may touch every surface |
| idea-3 | **Cheapest / fastest**: highest-leverage input & feedback wins only; ship minimum viable value today | minimum cost/time, scope strictly bounded |

## Key recon facts (shared ground truth for all candidates)

1. Two (really three) disjoint render stacks: REPL (`chat.ts` → splash + bare readline + `core/render.ts`), `aether code` (StatusRenderer/HostRenderer + animations + heartbeat + ledger + diff), and **TuiLayout (built, tested, wired to NOTHING)**.
2. REPL readline is created with `input` only — no prompt management, no history, no line-editing integration; dead air during turns (no thinking indicator until first delta).
3. `main.ts` hardcodes `VERSION = "0.1.0"` while `src/version.ts` is the declared single source (drift risk; chat splash imports version.ts).
4. Splash advertises `/effort` — no such slash command exists (`slash.ts`); `/mcp` is a stub.
5. Unknown top-level commands silently become cloud chat prompts (`aether statsu` → API call with "statsu").
6. Unknown slash commands print `unknown command: /x (try /help)` — no nearest-match suggestion.
7. `host_render.ts` done-frame: `[ OKAY ]` is cyan-badged, `[ FAIL ]` is **unstyled** (red exists in theme).
8. Two kaomoji tables exist (kaomoji.ts + statusbar.ts inline PHASES) — drift risk.
9. Final verify gate in code.ts runs only with explicit `--test-cmd`; default runs end "unverified" with no explanation of how to make them verified.
10. `slash.ts` output is entirely unstyled (no theme usage) — inconsistent with every other surface.
11. Ctrl+C in REPL: default abort, no graceful exit message; readline has no SIGINT handler.
12. Glyph language is rich but consistent (✓/✗/◐/⛓/⟢/⌁); error prefix `✗` used consistently in commands; `!` used in agent_events.
13. Tests pin: splash status column content, prompt prefix shape, kaomoji map, statusbar phases, ledger rendering, non-TTY cleanliness (StatusRenderer + TuiLayout).
14. theme.ts keys color off `process.stdout.isTTY` only — stderr writes (interact.ts notes, HostRenderer bars) inherit stdout's decision.

## Failure-condition check

Goal extractable: YES. Hard constraints extractable: YES (C1–C7). → proceed to nodes 2/3/4.
