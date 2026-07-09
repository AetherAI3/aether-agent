import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { Renderer } from "../src/core/render.js";
import { stripAnsi } from "../src/ui/theme.js";

class Capture extends Writable {
  private readonly chunks: string[] = [];

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

test("Renderer keeps duplicate orchestrator task labels distinct in the final ledger", () => {
  const out = new Capture();
  const err = new Capture();
  const renderer = new Renderer({ json: false, audit: false, out, err });

  renderer.frame({ type: "task_start", taskId: "a", label: "same" });
  renderer.frame({ type: "task_start", taskId: "b", label: "same" });
  renderer.frame({ type: "task_done", taskId: "a" });
  renderer.frame({ type: "task_done", taskId: "b" });
  renderer.frame({ type: "project_done" });

  const text = stripAnsi(out.text());
  assert.match(text, /✓ same \(a\)/);
  assert.match(text, /✓ same \(b\)/);
});