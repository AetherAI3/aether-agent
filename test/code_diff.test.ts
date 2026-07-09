import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editPreview } from "../src/commands/code.js";
import { ToolExecutor } from "../src/core/tool_executor.js";
import { stripAnsi } from "../src/ui/theme.js";

test("editPreview diffs an existing file against the new content", () => {
  const dir = mkdtempSync(join(tmpdir(), "aec-"));
  try {
    writeFileSync(join(dir, "f.txt"), "old\n");
    const out = stripAnsi(
      editPreview(new ToolExecutor(dir), {
        type: "tool_call",
        id: "1",
        name: "write_file",
        args: { path: "f.txt", content: "new\n" },
      }) ?? "",
    );
    assert.match(out, /- old/);
    assert.match(out, /\+ new/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("editPreview returns null for non-edit tools", () => {
  assert.equal(editPreview(new ToolExecutor("."), { type: "tool_call", id: "1", name: "run_tests", args: {} }), null);
});


test("editPreview does not read outside the workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "aec-"));
  try {
    assert.equal(
      editPreview(new ToolExecutor(dir), {
        type: "tool_call",
        id: "1",
        name: "write_file",
        args: { path: "../outside.txt", content: "new\n" },
      }),
      null,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
