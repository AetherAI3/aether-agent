import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import {
  AnimationController,
  sequenceFor,
  STAGE_MAP,
  type AnimationSink,
} from "../src/ui/animations.js";
import { HeartbeatIndicator } from "../src/ui/heartbeat.js";
import { computeRegions, TuiLayout } from "../src/ui/tui_layout.js";
import { stripAnsi } from "../src/ui/theme.js";
import { StatusRenderer } from "../src/ui/status_renderer.js";
import {
  mapBrainEvent,
  bindEventSource,
  LocalAgentSource,
  type AgentEvent,
  type AgentSource,
} from "../src/core/agent_events.js";

// --- animations: stage map + controller ------------------------------------
test("STAGE_MAP routes stages to sequences; unknown -> deep_strike", () => {
  assert.equal(STAGE_MAP["recon"], "radar");
  assert.equal(STAGE_MAP["error"], "kernel_panic");
  assert.equal(sequenceFor("totally-unknown").mode, "loop"); // deep_strike fallback
});

test("AnimationController renders a frame on setStage and freezes on stall", () => {
  const frames: Array<[string, string]> = [];
  const sink: AnimationSink = { onFrame: (s, a) => frames.push([s, a]) };
  const anim = new AnimationController(sink);
  anim.setStage("execute");
  assert.ok(frames.length >= 1, "first frame rendered synchronously");
  assert.equal(frames[0]![0], "execute");
  anim.markStalled();
  const last = frames[frames.length - 1]!;
  assert.match(last[1], /waiting/, "stall freezes with a waiting suffix");
  anim.stop();
});

test("one-shot stage renders static, no loop", () => {
  const frames: Array<[string, string]> = [];
  const anim = new AnimationController({ onFrame: (s, a) => frames.push([s, a]) });
  anim.setStage("reveal");
  assert.equal(frames.length, 1, "one-shot renders exactly one frame");
  anim.stop();
});

test("setProgress forwards to onProgress", () => {
  let got: [number, number] | null = null;
  const anim = new AnimationController({ onFrame: () => {}, onProgress: (u, c) => (got = [u, c]) });
  anim.setProgress(100, 500);
  assert.deepEqual(got, [100, 500]);
  anim.stop();
});

// --- heartbeat -------------------------------------------------------------
test("heartbeat: one beat reaches the peak then returns to rest", async () => {
  const seen: string[] = [];
  const hb = new HeartbeatIndicator({ onFrame: (g) => seen.push(g), frameMs: 1 });
  hb.beat();
  await delay(40);
  assert.ok(seen.includes("◉"), "beat reaches the peak glyph");
  assert.equal(hb.glyph(), "·", "rests between beats");
});

test("heartbeat: stall shows hollow; next beat clears it", () => {
  const hb = new HeartbeatIndicator({ frameMs: 1 });
  hb.markStalled();
  assert.equal(hb.glyph(), "○");
  hb.beat();
  assert.notEqual(hb.glyph(), "○");
  hb.stop();
});

// --- agent_events: adapter + watchdog --------------------------------------
test("mapBrainEvent adapts the bridge vocabulary to the UI slice", () => {
  assert.deepEqual(mapBrainEvent({ type: "stage", name: "recon", face: "" }), {
    type: "stage",
    stage: "recon",
  });
  assert.deepEqual(mapBrainEvent({ type: "tool_call", id: "c1", name: "read_file", args: { path: "a.py" } }), {
    type: "tool",
    name: "read_file",
    args: "a.py",
  });
  assert.deepEqual(mapBrainEvent({ type: "checkpoint", gitSha: "abc1234" }), { type: "commit", sha: "abc1234" });
  assert.deepEqual(mapBrainEvent({ type: "status", phase: "x", poolUsed: 1, poolCap: 2 }), {
    type: "token",
    used: 1,
    cap: 2,
  });
  assert.equal(mapBrainEvent({ type: "done", ok: true, result: "", remaining: 0, reason: "" })!.type, "done");
  assert.equal(mapBrainEvent({ type: "skill", name: "s", reason: "r" })!.type, "log");
  assert.equal(mapBrainEvent({ type: "telemetry", tokens: 0, tps: 0, ctxUsed: 0, ctxCap: 0, vram: 0 }), null);
});

test("bindEventSource: watchdog stalls on silence, resumes on the next event", async () => {
  const calls: string[] = [];
  const anim = {
    setStage: (s: string) => calls.push("stage:" + s),
    setProgress: () => {},
    markStalled: () => calls.push("stalled"),
    resume: () => calls.push("resume"),
    stop: () => {},
  };
  const ui = { log: () => {}, end: () => {} };
  let handler: (e: AgentEvent) => void = () => {};
  const fake: AgentSource = { on: (h) => (handler = h), close: () => {} };
  bindEventSource(fake, ui, anim, { heartbeatTimeoutMs: 20 });
  await delay(40);
  assert.ok(calls.includes("stalled"), "watchdog fires markStalled on silence");
  handler({ type: "heartbeat" });
  assert.ok(calls.includes("resume"), "next event resumes");
  handler({ type: "stage", stage: "execute" });
  assert.ok(calls.includes("stage:execute"), "stage dispatched after resume");
});

test("LocalAgentSource feeds adapted BrainEvents + a synthetic heartbeat", async () => {
  const seen: string[] = [];
  const src = new LocalAgentSource(10);
  src.on((e) => seen.push(e.type));
  src.feedBrain({ type: "stage", name: "recon", face: "" });
  await delay(25);
  src.close();
  assert.ok(seen.includes("stage"), "stage fired regardless of transport");
  assert.ok(seen.includes("heartbeat"), "synthetic heartbeat present");
});

// --- tui_layout: regions + pager + non-TTY safety --------------------------
test("computeRegions math", () => {
  const r = computeRegions(30, 5);
  assert.equal(r.transTop, 6);
  assert.equal(r.transHeight, 23);
  assert.equal(r.statusRow, 29);
  assert.equal(r.inputRow, 30);
});

test("pager preserves position when new output arrives while scrolled up", () => {
  const t = new TuiLayout({ mode: "api" });
  t.tty = true;
  t.regions = computeRegions(10, 1); // transHeight = 7
  for (let i = 0; i < 10; i++) t.transcript.push("L" + i);
  t.offset = 0;
  t.following = true;
  // Suppress the real ANSI writes for this in-memory pager test.
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    t.scrollUp(2);
    const [s1, w1] = t.visibleWindow();
    t.log("L10");
    const [s2, w2] = t.visibleWindow();
    assert.equal(s1, s2, "scroll position held");
    assert.equal(w1[0], w2[0], "top line unchanged");
    assert.equal(t.unseen, 1, "unseen counted");
    assert.equal(t.following, false, "not following while scrolled up");
    t.scrollToBottom();
    assert.equal(t.offset, 0, "End -> bottom");
    assert.equal(t.following, true, "End -> live");
    assert.equal(t.unseen, 0, "End -> unseen cleared");
    assert.equal(t.handleKey("pageup"), true, "PgUp consumed");
    assert.equal(t.handleKey("up"), false, "plain Up left for input editing");
  } finally {
    process.stdout.write = real;
  }
});

test("StatusRenderer non-TTY = plain lines, zero ANSI (keeps §8 logs clean)", () => {
  const prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  const out: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: string) => (out.push(String(c)), true)) as typeof process.stdout.write;
  try {
    const sr = new StatusRenderer({ mode: "local" });
    sr.start();
    sr.setStage("execute", "▸▹");
    sr.log("  : run_tests");
    sr.setProgress(100, 500);
    sr.end();
  } finally {
    process.stdout.write = real;
    if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
  }
  assert.ok(out.some((x) => x.includes("run_tests")), "scrollback line written");
  assert.ok(!out.some((x) => x.includes("\x1b[")), "no ANSI in non-TTY");
  assert.ok(!out.some((x) => x.includes("\r")), "no carriage-return pinning in non-TTY");
});

test("TuiLayout non-TTY stays plain (no ANSI)", () => {
  const prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  const out: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: string) => (out.push(String(c)), true)) as typeof process.stdout.write;
  try {
    const nt = new TuiLayout({ mode: "api" });
    nt.mount();
    nt.log("agent line");
    nt.setHeartbeat("●");
  } finally {
    process.stdout.write = real;
    if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
  }
  assert.ok(out.some((x) => x.includes("agent line")), "plain line written");
  assert.ok(!out.some((x) => x.includes("\x1b[")), "no ANSI in non-TTY");
});

test("a colored header line keeps its visible width (ANSI-safe slicing invariant)", () => {
  const colored = "\x1b[38;2;135;215;255mAETHER\x1b[0m";
  assert.equal(stripAnsi(colored).length, 6);
});

test("TuiLayout setVerb/setStreamed exist and don't throw off-TTY", () => {
  const prev = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  try {
    const t = new TuiLayout({ mode: "api", now: () => 0 });
    t.setVerb("Forging", "(ง'̀-'́)ง");
    t.setStreamed(33_000);
    assert.ok(true);
  } finally {
    if (prev) Object.defineProperty(process.stdout, "isTTY", prev);
  }
});
