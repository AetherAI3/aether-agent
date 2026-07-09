# AA-LOOP-02 (Agent Runtime & Tooling Mutate/Adversarial Cycle) — Spec Delivery Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new runnable loop spec, `docs/loops/AA-LOOP-02-agent-runtime-mutate-adversarial.md`, to `aether-agent`, and land it via its own small docs-only PR against `DBarr3/aether-agent`.

**Architecture:** Spec-only deliverable — no application code (`src/*`) is touched by this plan. The loop composes four patterns from the public `agentic-loops` Kernel (LOOP-04 agent-runtime five-facet audit, an explicit checkpoint node per the Kernel's own §7 workflow-recovery rule, LOOP-15 mutate/improve, LOOP-11 adversarial review), adapted to `aether-agent`'s actual runtime files (`ToolExecutor`, `autonomy.ts`/`verify_gate.ts`, `ContextRegistry`, `envelope.ts`/`brain_protocol.ts`), with the adversarial-review node as the sole loop-back/re-entry point — same shape as the repo's existing `AA-LOOP-01`. The loop itself is not executed by this plan — only authored and delivered.

**Tech Stack:** Markdown spec (frontmatter + mermaid DAG), git, `gh` CLI.

**Spec source material:** `C:\Users\lilbe\Documents\GitHub\agentic-loops\PROTOCOL.md`, `skills/LOOP-04-agent-runtime.md`, `skills/LOOP-11-adversarial-review.md`, `skills/LOOP-15-self-optimization.md`, `skills/LOOP-08-cicd-release.md`; this repo's own `docs/loops/AA-LOOP-01-ux-ui-mutate-adversarial.md` as the in-repo style precedent; grounded against `src/core/{mcp,tool_executor,autonomy,verify_gate,envelope,context_registry,brain_protocol,worktree,custody,github}.ts` and `src/commands/{mcp,workflow}.ts`.

---

### Task 1: Author the loop spec file

**Files:**
- Create: `docs/loops/AA-LOOP-02-agent-runtime-mutate-adversarial.md`

- [x] **Step 1: Write the full spec** — frontmatter (`loop-id: AA-LOOP-02`, `risk-class: branch-mutating`, `default-debate: FREE-MAD`), Mission, Trigger, Inputs, Preconditions, mermaid Execution DAG (seed → save-progress → mutate ⇄ adversarial-review → execute, loop-back edge 5→4 only), 9 Node Specs each with QOPC output artifact, Adversarial Check persona, quantitative Exit Criteria, Failure Routing, Approval Gates (hard repo-boundary gate + a standing gate on `gateActionFor`/`decideGate` changes), and a copy-pasteable RUN PROMPT.
- [x] **Step 2: Self-review against the operator's DAG** — confirm every element requested is present: begin with LOOP-04 agent-runtime-&-tooling pattern ✓ (Node 1, five facets grounded in real files: `mcp.ts`, `tool_executor.ts`, `autonomy.ts`/`verify_gate.ts`, `context_registry.ts`, `envelope.ts`/`brain_protocol.ts`), save progress ✓ (Node 2, explicit checkpoint node — distinct from AA-LOOP-01's implicit-only checkpointing, per the operator's explicit DAG step), LOOP-15 mutate/improve ✓ (Node 3, re-entry A), LOOP-11 adversarial debate ✓ (Node 4, re-entry point B, FREE-MAD), "loop until done" ✓ (5→4 loop-back edge, exit criteria requires zero `OPEN` findings), simplify ✓ (Node 6), label code ✓ (Node 7, PR labels + ~300-line file-size hygiene), ci/cd ✓ (Node 8, mapped to this repo's actual gate — `npm test`, no GitHub Actions exist here), PR ✓ (Node 9, scoped to `aether-agent` only, explicit anti-agentic-loops guard matching AA-LOOP-01).

### Task 2: Land the spec via its own PR

**Files:**
- New: `docs/loops/AA-LOOP-02-agent-runtime-mutate-adversarial.md` (Task 1)
- New: `docs/plans/2026-07-09-aa-loop-02-agent-runtime-mutate-adversarial-spec.md` (this file)

- [ ] **Step 1: Create branch from `origin/main`**

```bash
git fetch origin
git checkout -b docs/aa-loop-02-agent-runtime-spec origin/main
```

- [ ] **Step 2: Stage and commit**

```bash
git add docs/loops/AA-LOOP-02-agent-runtime-mutate-adversarial.md docs/plans/2026-07-09-aa-loop-02-agent-runtime-mutate-adversarial-spec.md
git commit -m "docs: add AA-LOOP-02 agent-runtime mutate/adversarial loop spec"
```

- [ ] **Step 3: Push**

```bash
git push -u origin docs/aa-loop-02-agent-runtime-spec
```

- [ ] **Step 4: Open PR against `DBarr3/aether-agent` (never `agentic-loops`)**

```bash
gh pr create --repo DBarr3/aether-agent --base main \
  --title "docs: AA-LOOP-02 — agent-runtime & tooling mutate/adversarial-review loop spec" \
  --body "Spec-only. Adds a runnable loop (docs/loops/AA-LOOP-02-agent-runtime-mutate-adversarial.md) that seeds a fresh LOOP-04-pattern five-facet audit (schema strictness, least-privilege agency, context hygiene, prompt-injection surfaces, untrusted-data boundary) against this repo's own MCP client / tool executor / autonomy gate / context registry / brain protocol, checkpoints the findings, then cycles mutate -> adversarial-review -> execute per finding, re-entering at the review node until every finding is closed, then /simplify, file-size/labels hygiene, npm test gate, PR. Not executed by this PR - no src/ changes."
```

- [ ] **Step 5: Report the PR URL back to the operator.** No merge without explicit approval (loop's own Approval Gates apply to this delivery too).
