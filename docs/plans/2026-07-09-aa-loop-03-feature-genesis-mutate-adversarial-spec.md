# AA-LOOP-03 (Feature Genesis Mutate/Adversarial Cycle) — Spec Delivery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new runnable loop spec, `docs/loops/AA-LOOP-03-feature-genesis-mutate-adversarial.md`, to `aether-agent`, and land it via its own small docs-only PR against `DBarr3/aether-agent`.

**Architecture:** Spec-only deliverable — no application code (`src/*`) is touched by this plan (the loop itself, once run, DOES touch `src/*` — that's its job — but authoring and delivering the spec does not). The loop composes four patterns from the public `agentic-loops` Kernel (an open-ended brainstorm/shortlist node with no direct LOOP-XX precedent, LOOP-15 mutate/improve applied at the spec level, LOOP-11 adversarial review used twice — once pre-code, once post-code, LOOP-06 UX/UI and LOOP-01 backend-API patterns run as parallel build tracks), grounded against this repo's real command/tool/MCP surface (`COMMANDS.md`, `src/commands/slash_registry.ts`, `src/core/mcp.ts`, `src/core/mcp_store.ts`, `src/core/tool_executor.ts`). It reuses `AA-LOOP-01`'s and `AA-LOOP-02`'s established shape (re-entrant review node, terminal-adapted LOOP-06 substitutions, `npm test`-as-CI/CD, hard `aether-agent`-only repo boundary) rather than inventing new conventions. The loop itself is not executed by this plan — only authored and delivered.

**Tech Stack:** Markdown spec (frontmatter + mermaid DAG), git, `gh` CLI.

**Spec source material:** `C:\Users\lilbe\Documents\GitHub\agentic-loops\PROTOCOL.md`, `skills/LOOP-01-backend-api.md`, `skills/LOOP-06-ux-ui-visual.md`, `skills/LOOP-11-adversarial-review.md`, `skills/LOOP-15-self-optimization.md`; this repo's own `docs/loops/AA-LOOP-01-ux-ui-mutate-adversarial.md` and `docs/loops/AA-LOOP-02-agent-runtime-mutate-adversarial.md` as the in-repo style precedent; grounded against `COMMANDS.md`, `src/commands/slash_registry.ts`, `src/core/mcp.ts`, `src/core/mcp_store.ts`, `src/core/tool_executor.ts`, `CONTRIBUTING.md` (zero-runtime-dep, ~300-line-file, TDD bar).

---

### Task 1: Author the loop spec file

**Files:**
- Create: `docs/loops/AA-LOOP-03-feature-genesis-mutate-adversarial.md`

- [x] **Step 1: Write the full spec** — frontmatter (`loop-id: AA-LOOP-03`, `risk-class: branch-mutating`, `default-debate: FREE-MAD`), Mission, Trigger, Inputs, Preconditions, mermaid Execution DAG (brainstorm → concept-mutate ⇄ concept-debate → [parallel UI/UX build + backend build] → code-debate ⇄ [UI or backend] → simplify → organize → CI/CD → PR), 10 Node Specs each with QOPC output artifact, a two-stage Adversarial Check (concept persona + code persona), quantitative Exit Criteria, Failure Routing, Approval Gates (hard repo-boundary gate + a new high-risk-capability pre-screen gate), and a copy-pasteable RUN PROMPT.
- [x] **Step 2: Self-review against the operator's DAG** — confirm every element requested is present: brainstorm new commands/tools/MCP/features ✓ (Node 1, grounded against `COMMANDS.md`/`slash_registry.ts`/`mcp_store.ts`/`tool_executor.ts`, not invented busywork), "15 mutate, debate ... in sync" ✓ (Nodes 2–3: LOOP-15-pattern mutate paired with LOOP-11 FREE-MAD debate, re-entrant, node 3 is the sole re-entry point — same discipline as AA-LOOP-01/02), "after pass, ui/ux 06 + 01 backend in sync" ✓ (Nodes 4–5, tagged `[P]`, both consume the same node-3 PASS spec and run concurrently, terminal-adapted LOOP-06 exactly as AA-LOOP-01 substituted it), "re loop adversarial debate 11 and fix until pass" ✓ (Node 6, second FREE-MAD cycle over the *combined* diff, REVISE routed to whichever track owns the flaw), "simplify, label, organize code as much as possible" ✓ (Nodes 7–8, `/simplify` + PR labels + ~300-line hygiene, explicitly not conflating this loop's new-length violations with `workflow.ts`'s pre-existing ones), "ci/cd, pr" ✓ (Node 9 mapped to this repo's actual gate — `npm run build && npm test`, no GitHub Actions exist here — Node 10 scoped to `aether-agent` only, explicit anti-`agentic-loops` guard matching AA-LOOP-01/02).

### Task 2: Land the spec via its own PR

**Files:**
- New: `docs/loops/AA-LOOP-03-feature-genesis-mutate-adversarial.md` (Task 1)
- New: `docs/plans/2026-07-09-aa-loop-03-feature-genesis-mutate-adversarial-spec.md` (this file)

- [ ] **Step 1: Create branch from `origin/main`**

```bash
git fetch origin
git checkout -b docs/aa-loop-03-feature-genesis-spec origin/main
```

- [ ] **Step 2: Stage and commit**

```bash
git add docs/loops/AA-LOOP-03-feature-genesis-mutate-adversarial.md docs/plans/2026-07-09-aa-loop-03-feature-genesis-mutate-adversarial-spec.md
git commit -m "docs: add AA-LOOP-03 feature-genesis mutate/adversarial loop spec"
```

- [ ] **Step 3: Push**

```bash
git push -u origin docs/aa-loop-03-feature-genesis-spec
```

- [ ] **Step 4: Open PR against `DBarr3/aether-agent` (never `agentic-loops`)**

```bash
gh pr create --repo DBarr3/aether-agent --base main \
  --title "docs: AA-LOOP-03 — feature-genesis mutate/adversarial-review loop spec" \
  --body "Spec-only. Adds a runnable loop (docs/loops/AA-LOOP-03-feature-genesis-mutate-adversarial.md) that brainstorms a new command/tool/MCP integration/feature grounded in this repo's real gaps, hardens the concept through a paired LOOP-15-pattern mutate / LOOP-11 FREE-MAD adversarial-debate cycle (review node is the re-entry point) until PASS, builds it on two parallel tracks (LOOP-06-pattern terminal UI/UX + LOOP-01-pattern backend), re-verifies the combined diff through a second adversarial-debate cycle routed per-track until PASS, then /simplify, file-size/labels hygiene, npm test gate, PR. Not executed by this PR - no src/ changes."
```

- [ ] **Step 5: Report the PR URL back to the operator.** No merge without explicit approval (loop's own Approval Gates apply to this delivery too).
