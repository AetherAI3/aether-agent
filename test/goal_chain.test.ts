// test/goal_chain.test.ts — the goal chain must emit WELL-FORMED truecolor
// escapes (the old helpers terminated the sequence early and printed raw
// ";2;r;g;bm" text on screen) and keep box rows width-aligned.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGoalChain, renderPhaseDetail } from "../src/ui/goal_chain.js";
import { stripAnsi, visibleWidth } from "../src/ui/text.js";
import type { Goal } from "../src/core/goals.js";

function sampleGoal(): Goal {
  return {
    id: "g1",
    title: "Ship the frontend overhaul",
    status: "running",
    selectedPhaseId: "phase-1",
    activePhaseId: "phase-1",
    phases: [
      {
        id: "phase-1",
        title: "Recon",
        description: "map the surfaces",
        status: "complete",
        userNote: "",
        tasks: [{ id: "t1", title: "read files", status: "complete" }],
      },
      {
        id: "phase-2",
        title: "Execute",
        description: "make the fixes",
        status: "in_progress",
        userNote: "watch the pager",
        tasks: [
          { id: "t2", title: "fix tui", status: "in_progress" },
          { id: "t3", title: "fix chat", status: "pending" },
        ],
      },
    ],
  } as unknown as Goal;
}

test("goal chain emits well-formed truecolor sequences", () => {
  const out = renderGoalChain(sampleGoal(), 100).join("\n");
  assert.ok(out.includes("\x1b[38;2;"), "single-sequence truecolor present");
  const plain = stripAnsi(out);
  assert.ok(!plain.includes(";2;"), "no raw truecolor fragments leak as text");
  assert.ok(!plain.includes(";5;240m"), "no raw 256-color fragments leak as text");
});

test("phase box rows align (equal visible width)", () => {
  const lines = renderGoalChain(sampleGoal(), 100);
  // rows 2..7 are the 6 box rows (after title + blank)
  const boxRows = lines.slice(2, 8);
  const widths = boxRows.map((r) => visibleWidth(r));
  assert.ok(widths.every((w) => w === widths[0]), `box rows aligned: ${widths.join(",")}`);
});

test("phase detail panel emits no raw escape fragments", () => {
  const out = renderPhaseDetail(sampleGoal(), 100).join("\n");
  assert.ok(!stripAnsi(out).includes(";2;"), "detail panel clean");
});
