import { test } from "node:test";
import assert from "node:assert/strict";
import { progressBar } from "../src/ui/progress.js";
import { kaomoji } from "../src/ui/kaomoji.js";
import { statusLines } from "../src/ui/splash.js";
import { promptPrefix } from "../src/ui/prompt.js";
import { actionLine, subActionLine } from "../src/ui/agent.js";
import { stripAnsi } from "../src/ui/theme.js";

test("progressBar fills/hashes by fraction with pct affixed right", () => {
  assert.equal(progressBar(0.5, 20), "|██████████##########| 50%");
  assert.equal(progressBar(0, 4), "|####| 0%");
  assert.equal(progressBar(1, 4), "|████| 100%");
  assert.equal(progressBar(2, 4), "|████| 100%"); // clamps over 1
});

test("kaomoji maps each agent state", () => {
  assert.equal(kaomoji("active"), "(๑•̀ㅂ•́)و✧✎");
  assert.equal(kaomoji("scanning"), "(ノ￣ー￣)ノ⌨");
  assert.equal(kaomoji("logging"), "＿φ(°-°=)");
  assert.equal(kaomoji("idle"), "(⌨_⌨)");
  assert.equal(kaomoji("error"), "( Ò﹏Ó)✎");
});

test("status column = the four spec lines", () => {
  const s = statusLines({ version: "0.1.0", model: "sonnet", effort: "high" }).map(stripAnsi);
  assert.equal(s[0], "AETHER CODE");
  assert.equal(s[1], "v0.1.0");
  assert.ok(s[2]?.includes("/model") && s[2].includes("sonnet"));
  assert.ok(s[2]?.includes("/effort") && s[2].includes("high"));
  assert.ok(s[3]?.includes("/mcp") && s[3].includes("/doctor"));
});

test("prompt prefix is [user]_:", () => {
  assert.equal(stripAnsi(promptPrefix("dbarr")), "[dbarr]_: ");
});

test("action + sub-action lines match the spec shape", () => {
  const a = stripAnsi(actionLine("creating worktree", "active", "aether/worktree", 0.8));
  assert.ok(a.startsWith("* creating worktree (๑•̀ㅂ•́)و✧✎ aether/worktree"));
  assert.ok(a.includes("80%"));
  const sub = stripAnsi(subActionLine("scanning", "recon", "scanning uvt logs.", 0.2));
  assert.ok(sub.includes(": (ノ￣ー￣)ノ⌨ recon -"));
  assert.ok(sub.includes("20%"));
});
