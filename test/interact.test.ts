import { test } from "node:test";
import assert from "node:assert/strict";
import { confirm, ask, parseAgentQuestion, type PromptIO } from "../src/ui/interact.js";

interface FakeIO extends PromptIO {
  notes: string[];
  asked: string[];
}

/** A scripted PromptIO: `answers` are returned in order; notes + prompts captured. */
function fakeIO(answers: string[], tty = true): FakeIO {
  const notes: string[] = [];
  const asked: string[] = [];
  let i = 0;
  return {
    tty,
    notes,
    asked,
    note: (l: string): void => void notes.push(l),
    question: (q: string): Promise<string> => {
      asked.push(q);
      return Promise.resolve(answers[i++] ?? "");
    },
  };
}

// --- confirm ---------------------------------------------------------------
test("confirm: a blank answer takes the default", async () => {
  assert.equal(await confirm(fakeIO([""]), "ok?"), true);
  assert.equal(await confirm(fakeIO([""]), "ok?", { default: false }), false);
});

test("confirm: natural yes/no words parse", async () => {
  assert.equal(await confirm(fakeIO(["yes"]), "?"), true);
  assert.equal(await confirm(fakeIO(["yep"]), "?"), true);
  assert.equal(await confirm(fakeIO(["n"]), "?"), false);
  assert.equal(await confirm(fakeIO(["nope"]), "?"), false);
});

test("confirm: re-asks ONCE on garbage, then takes the default", async () => {
  const io = fakeIO(["maybe", "what"]);
  assert.equal(await confirm(io, "?", { default: true }), true);
  assert.equal(io.asked.length, 2, "asked twice");
  assert.ok(io.notes.some((n) => /y or n/.test(n)), "nudged the user");
});

test("confirm: --yes short-circuits to true without prompting", async () => {
  const io = fakeIO([]);
  assert.equal(await confirm(io, "?", { autoYes: true }), true);
  assert.equal(io.asked.length, 0, "never prompted");
});

test("confirm: non-TTY returns the default without prompting (never hangs a pipe)", async () => {
  const io = fakeIO([], false);
  assert.equal(await confirm(io, "?", { default: false }), false);
  assert.equal(io.asked.length, 0, "never prompted");
});

// --- ask -------------------------------------------------------------------
test("ask: returns the trimmed free-text answer", async () => {
  assert.equal(await ask(fakeIO(["  /repo/path  "]), "where?"), "/repo/path");
});

test("ask: non-TTY / --yes returns the auto value", async () => {
  assert.equal(await ask(fakeIO([], false), "where?", { auto: "." }), ".");
  assert.equal(await ask(fakeIO([]), "where?", { autoYes: true, auto: "x" }), "x");
});

// --- parseAgentQuestion (host-side question convention over the frozen wire) ---
test("parseAgentQuestion: recognizes the question markers", () => {
  assert.equal(parseAgentQuestion("❓ Which database should I target?"), "Which database should I target?");
  assert.equal(parseAgentQuestion("question: keep the old API?"), "keep the old API?");
  assert.equal(parseAgentQuestion("ASK USER: rename the module?"), "rename the module?");
  assert.equal(parseAgentQuestion("?> proceed with the risky migration?"), "proceed with the risky migration?");
});

test("parseAgentQuestion: ordinary monologue is not a question", () => {
  assert.equal(parseAgentQuestion("Scanning the repo for vulnerabilities."), null);
  assert.equal(parseAgentQuestion("question:"), null); // marker with no body
  assert.equal(parseAgentQuestion(""), null);
});
