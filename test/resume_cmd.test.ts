import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeHint } from "../src/commands/resume.js";

test("resumeHint quotes the exact re-entry command", () => {
  assert.equal(
    resumeHint("2026-06-08T12-00-00-000Z-cloud"),
    "session paused — resume with:  aether agent --resume 2026-06-08T12-00-00-000Z-cloud",
  );
});
