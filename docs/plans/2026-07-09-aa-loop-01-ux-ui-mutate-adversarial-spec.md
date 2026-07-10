# AA-LOOP-01 (UX/UI Mutate/Adversarial Cycle) — Spec Delivery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new runnable loop spec, `docs/loops/AA-LOOP-01-ux-ui-mutate-adversarial.md`, to `aether-agent`, and land it via its own small docs-only PR against `DBarr3/aether-agent`.

**Architecture:** Spec-only deliverable — no application code (`src/*`) is touched by this plan. The loop composes three patterns from the private `loop-engineering` Kernel (LOOP-06 seed audit, LOOP-15 mutate/improve, LOOP-11 adversarial review), adapted for a terminal UI target, with the adversarial-review node as the sole loop-back/re-entry point (mirrors Kernel §7's own "resume at node 11" rule). The loop itself is not executed by this plan — only authored and delivered.

**Tech Stack:** Markdown spec (frontmatter + mermaid DAG), git, `gh` CLI.

**Spec source material:** `C:\Users\lilbe\loop-engineering\01-SHARED-PROTOCOL.md`, `LOOP-06-ux-ui-visual.md`, `LOOP-11-adversarial-review.md`, `LOOP-15-self-optimization.md`; seeded findings from `docs/reviews/2026-06-10-terminal-ux-sweep.md` (already in this repo).

---

### Task 1: Author the loop spec file

**Files:**
- Create: `docs/loops/AA-LOOP-01-ux-ui-mutate-adversarial.md`

- [x] **Step 1: Write the full spec** — frontmatter (`loop-id: AA-LOOP-01`, `risk-class: branch-mutating`, `default-debate: FREE-MAD`), Mission, Trigger, Inputs, Preconditions, mermaid Execution DAG (seed → mutate ⇄ adversarial-review → execute, loop-back edge 4→3 only), 8 Node Specs each with QOPC output artifact, Adversarial Check persona, quantitative Exit Criteria, Failure Routing, Approval Gates (hard repo-boundary gate: PRs land in `aether-agent` only, never `agentic-loops`), and a copy-pasteable RUN PROMPT.
- [x] **Step 2: Self-review against the spec** — confirm every element the operator asked for is present: DAG ✓ (mermaid + numbered nodes), QOPC ✓ (per-node output artifacts + gates), `/simplify` before PR ✓ (Node 5), labels + code organization ✓ (Node 6), CI/CD gate ✓ (Node 7, mapped to this repo's actual gate — `npm test`, no GitHub Actions exist here), PR scoped to `aether-agent` only ✓ (Node 8 + Approval Gates, explicit anti-agentic-loops guard).

### Task 2: Land the spec via its own PR

**Files:**
- New: `docs/loops/AA-LOOP-01-ux-ui-mutate-adversarial.md` (Task 1)
- New: `docs/plans/2026-07-09-aa-loop-01-ux-ui-mutate-adversarial-spec.md` (this file)

- [ ] **Step 1: Create branch from `origin/main`**

```bash
git fetch origin
git checkout -b docs/aa-loop-01-ux-ui-spec origin/main
```

- [ ] **Step 2: Stage and commit**

```bash
git add docs/loops/AA-LOOP-01-ux-ui-mutate-adversarial.md docs/plans/2026-07-09-aa-loop-01-ux-ui-mutate-adversarial-spec.md
git commit -m "docs: add AA-LOOP-01 UX/UI mutate/adversarial loop spec"
```

- [ ] **Step 3: Push**

```bash
git push -u origin docs/aa-loop-01-ux-ui-spec
```

- [ ] **Step 4: Open PR against `DBarr3/aether-agent` (never `agentic-loops`)**

```bash
gh pr create --repo DBarr3/aether-agent --base main \
  --title "docs: AA-LOOP-01 — UX/UI mutate/adversarial-review loop spec" \
  --body "Spec-only. Adds a runnable loop (docs/loops/AA-LOOP-01-ux-ui-mutate-adversarial.md) that seeds from the existing terminal UX sweep (docs/reviews/2026-06-10-terminal-ux-sweep.md), then cycles mutate -> adversarial-review -> execute per finding, re-entering at the review node until every finding is closed, then /simplify, file-size/labels hygiene, npm test gate, PR. Not executed by this PR - no src/ changes."
```

- [ ] **Step 5: Report the PR URL back to the operator.** No merge without explicit approval (loop's own Approval Gates apply to this delivery too).
