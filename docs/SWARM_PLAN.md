# /swarm — implementation plan (gated; build AFTER single-agent proof)

Source: `AETHER_GEMMA_SWARM_brainstorm.md`. Status: **NOT built.** The `--swarm`
flag exists but refuses (see `commands/code.ts`). This is the ordered plan to
unlock it. Swarming an unproven loop multiplies the #1 failure (tool-call
fraying), so this is sequenced last on purpose.

## Hard constraints (from the spec — do not violate)
- **LOCAL ONLY.** `/swarm` never touches the cloud/AetherCloud path. The cloud has
  its own orchestration (Neo/Kronus + unified router). Swarm is built on local
  primitives: local Ollama concurrency, local git worktrees, the on-disk shared pool.
- **Model-agnostic.** Any local model in the roster, mixed freely. Light Gemma just
  makes large worker counts cheap. No model assumptions in the harness.
- **Gate before build:** prove single-agent emission (`TESTING_HANDOFF.md §8`),
  then prove a light **Gemma** single agent (frays earlier → the early-vs-late
  measurement matters more), THEN swarm.

## The insight
The Unlimited Context disk pool is already a **blackboard** — shared, disk-backed
memory. `/swarm N` = N agents READ one shared pool, each WRITES to its own git
worktree on a disjoint partition. Read-shared / write-isolated → no edit collisions.

## Build order

### 1. Gemma profile in the adapter — DONE (prerequisite, already shipped)
`aether_agent/profiles.py` (Gemma light tier, Google sampling) + per-model sampling
in `adapter.py` + emission fray markers (`malformed-args`, `invented-tool`). Prove
it with §8 on a single Gemma agent before step 2.

### 2. Shared-pool blackboard (`--pool-mode shared` + claim/lease)
On the existing engine. Add to the engine's `Session`/pool a shared-open mode and a
coordination namespace:
- `claim/lease`: a worker atomically claims a sub-task (write a claim slice with a
  TTL lease); all workers see claims; an expired lease lets a free worker take over a
  stalled partition. No duplicate work, no central bottleneck.
- shared reads: every worker reads all diffs / test results / decisions / winner+trap
  patterns; a trap one worker confirms becomes an instant −witness for the rest.
- File: `aether_agent/swarm/blackboard.py` (claim/lease/post-progress/list-claims).

### 3. Coordinator: decompose → worktree-per-worker → merge gate
- **Decompose** the task into disjoint partitions (independent failing-test clusters,
  separate modules, per-file). Decomposition IS the whole game — a bad partition →
  collisions or idle agents. If it won't partition cleanly, fall back to ONE agent.
- **Worktree per worker:** `git worktree add` on an assigned partition (same isolation
  trick as the parallel build, at runtime).
- **Merge gate:** coordinator merges worktrees, runs the FULL suite, resolves
  conflicts. "Done" = all partitions green + merged + no regressions.
- File: `aether_agent/swarm/coordinator.py`.

### 4. `/swarm N` wiring (reuse the host + event protocol)
- Each worker is the EXISTING headless brain over the EXISTING bridge — one brain
  process per worker, all driven by the TS host. No new protocol; **add an `agent_id`
  field** to events so the host can render N lanes and the log can attribute per-agent.
- Per-agent `StageRecord`/diag from the start (the spec insists — feeds a future Audit
  Oracle: "which agent, which stage, what diverged"). The `malformed-args` /
  `invented-tool` / emission-rate markers already give per-agent fray signals; the
  swarm just tags them with `agent_id`.
- TS host: render per-agent lanes; the session log writes one `events.jsonl` per agent
  under the session dir. Lift the gate in `commands/code.ts` once 2–3 are green.

### 5. Swarm kill-gate (vs single agent)
Swarm-of-N vs ONE agent on a LARGE partitionable task: faster / more fixed WITHOUT
more regressions or merge hell? If it mostly makes conflicts + duplicate work, it's
net-negative — do not ship. Coordination overhead means swarms win only on large,
cleanly-separable work.

## Resource reality (honest)
With Ollama, N workers share ONE loaded model instance (concurrent requests), not N
copies — swarm cost is **concurrency**, not N× model RAM. Bounded by
`OLLAMA_NUM_PARALLEL` + VRAM for N concurrent KV caches (~8 parallel wants >24 GB
VRAM) + one shared pool. A swarm = one loaded light model + one pool + N loops, capped
by VRAM-for-concurrency. This is why the light Gemma tier (step 1) is the enabler.

## What unlocking looks like
Replace the refusal in `commands/code.ts` with: require `--local`, spin a coordinator,
fan out N worker brains tagged `agent_id`, render lanes, merge-gate. Until the kill-gate
(step 5) passes on a real partitionable task, keep it behind an explicit
`--swarm-experimental` opt-in, not the bare `--swarm`.
