# Consolidate Command SSOT + Release Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `COMMANDS.md` the single source of truth for every slash command shipped by today's PRs (#4–#16), refresh the README teaser to match, and add a `release/` folder with one-line-per-PR patch notes.

**Architecture:** Docs-only. The live registry is `src/commands/slash.ts` (the `switch` in `handleSlash` + `printHelp` sections). That registry is authoritative; `COMMANDS.md` must mirror it exactly. README keeps a short teaser pointing at `COMMANDS.md`. New `release/2026-06-09.md` summarizes the day's merged PRs, one sentence each.

**Tech Stack:** Markdown only. No build, no tests beyond `npx tsc --noEmit` sanity (no code changes) + visual diff review.

---

## File Structure

- Modify: `COMMANDS.md` — replace the stale 9-row "Slash commands" table (lines ~133-145) with the full grouped reference matching `slash.ts`.
- Modify: `README.md:105` — refresh the inline slash teaser list to name the real command groups.
- Create: `release/2026-06-09.md` — dated patch notes, one sentence per merged PR.
- Create: `release/README.md` — index/explainer for the release folder.

## Source of truth: every slash command in `slash.ts`

Grouped exactly as `printHelp` renders them:

**Session:** `/help` · `/models` · `/model <n|id>` · `/agents` · `/agent <n|id>` · `/tier` · `/audit [n]` · `/doctor` · `/clear` · `/exit` `/quit` · `/mcp` (coming soon)

**Agent Modes** (handled in REPL): `/autonomous-execution <task>` · `/subagent-driven-execution <task>` · `/self-review` · `/recon <topic>` · `/plan <topic>` · `/research <topic>` · `/review` · `/code-review` · `/writing-skills` · `/writing-plans <topic>`

**Steering:** `/queue <task>` · `/steer <guidance>` · `/btw <note>`

**Context & Limits:** `/pin <path> [reason]` · `/pin list` · `/drop <path>` · `/snapshot [resume <id>|list]` · `/limit <uvt|off>` · `/audit-receipt [n]` · `/rollback [n]` · `/logs-view` (`/logs`)

**Goals & Workflows:** `/goal <desc>` (+ `view|start|pause|resume|cancel|complete|note`) · `/goals [id]` · `/workflow` · `/workflow-templates` · `/workflow-template <n>`

**Vault:** `/vault` · `/vault-context` · `/vault-search <q>` · `/vault-recent [n]` · `/vault-project <name>` · `/vault-tag <tag>` · `/vault-tree`

**Orchestra** (orchestrator-gated, needs `/agent neo|kronus`): `/delegate <model> <task>` · `/tree` · `/broadcast "<msg>"` · `/gather <id|all>`

## Today's merged PRs (1 sentence each)

- #4 — Embeddable terminal renderer (RenderSink) lands plus the aether-code → aether-agent rebrand on main.
- #5 — Branded terminal installer and redesigned auth panel.
- #6 — Vault terminal commands (`/vault*`) for browsing notes from the REPL.
- #7 — QOPC memory bridge: live memory display in the terminal.
- #8 — Auth UI redesign, branded installers, and box rendering primitives.
- #9 — Steering + planning slash commands (`/queue` `/steer` `/btw` `/writing-plans` `/subagent-driven-execution`).
- #10 — Workflow terminal commands.
- #11 — Workflow v2: save / export / import + AI generation.
- #12 — Behavioral memory skills surfaced through the QOPC memory bridge display.
- #13 — `/goal` and `/goals`: persistent task-chain display with phase boxes.
- #14 — Interactive model picker, 8 agent-mode slash commands, and a redesigned `/help`.
- #15 — Session-control slash commands (`/pin` `/drop` `/snapshot` `/limit` `/audit-receipt` `/rollback` `/logs-view`).
- #16 — Orchestrator-gated slash commands (`/delegate` `/tree` `/broadcast` `/gather`).

---

### Task 1: Rewrite the COMMANDS.md slash section

**Files:**
- Modify: `COMMANDS.md` (Slash commands section)

- [ ] Replace the 9-row table with grouped subsections (Session, Agent Modes, Steering, Context & Limits, Goals & Workflows, Vault, Orchestra) using the source-of-truth list above.
- [ ] Add a one-line note that Orchestra commands require an active orchestrator (`/agent neo|kronus`).
- [ ] Verify every command in the doc exists as a `case` in `src/commands/slash.ts`.

### Task 2: Refresh README teaser

**Files:**
- Modify: `README.md:105`

- [ ] Replace the inline slash list with the real groups + a pointer to `COMMANDS.md` and `release/`.

### Task 3: Create release folder

**Files:**
- Create: `release/2026-06-09.md`
- Create: `release/README.md`

- [ ] Write `release/2026-06-09.md` with the 13 one-line PR summaries above, grouped, with a short header.
- [ ] Write `release/README.md` explaining the folder is the dated patch-note log.

### Task 4: Verify + PR

- [ ] `npx tsc --noEmit` (no code changed — confirms tree still clean).
- [ ] `git diff` review: docs only.
- [ ] Commit, push, open PR to `main`.
