import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEventToStatus } from "../src/commands/code.js";
import { StatusRenderer } from "../src/ui/status_renderer.js";
import { AnimationController } from "../src/ui/animations.js";
import { stripAnsi } from "../src/ui/theme.js";

test("AnimationController frames reach the status line via setAnim", () => {
  const sr = new StatusRenderer({ quiet: true, now: () => 0 });
  const anim = new AnimationController({ onFrame: (_stage, art) => sr.setAnim(art) });
  anim.setStage("execute"); // deep_strike frame 0 renders synchronously
  anim.stop();
  assert.match(stripAnsi(sr.composeLine()), /▹/, "stage art visible in the pinned line");
});

test("stage event sets the verb; telemetry sets streamed tokens", () => {
  const sr = new StatusRenderer({ quiet: true, now: () => 0 });
  applyEventToStatus(sr, { type: "stage", name: "execute", face: "" }, 0);
  applyEventToStatus(
    sr,
    { type: "telemetry", tokens: 33_000, tps: 0, ctxUsed: 0, ctxCap: 0, vram: 0 },
    0,
  );
  const line = stripAnsi(sr.composeLine());
  assert.match(line, /Forging…/);
  assert.match(line, /↑ 33\.0K tokens/);
});
