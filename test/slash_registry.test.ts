import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import {
  SLASH_COMMANDS,
  slashNames,
  damerau,
  nearest,
  suggestTopLevel,
  slashCompletions,
} from "../src/commands/slash_registry.js";
import { handleSlash } from "../src/commands/slash.js";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { AppContext } from "../src/core/context.js";

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

// help/default/effort-dial paths only read cfg — a cfg-only stub is safe here.
const ctx = { cfg: { ...DEFAULT_CONFIG } } as unknown as AppContext;

test("damerau counts the transposition typo as one edit", () => {
  assert.equal(damerau("auht", "auth"), 1);
  assert.equal(damerau("model", "model"), 0);
  assert.equal(damerau("modle", "model"), 1);
  assert.equal(damerau("hello", "help"), 2);
  assert.equal(damerau("", "abc"), 3);
});

test("nearest respects the max-distance budget", () => {
  assert.equal(nearest("modle", slashNames(), 2), "model");
  assert.equal(nearest("qit", slashNames(), 2), "quit");
  assert.equal(nearest("zzzzzz", slashNames(), 2), null);
});

test("suggestTopLevel: short tokens need distance 1, longer allow 2", () => {
  assert.equal(suggestTopLevel("auht"), "auth"); // transposition, d=1
  assert.equal(suggestTopLevel("confg"), "config"); // d=1
  assert.equal(suggestTopLevel("moddels"), "models"); // d=1
  assert.equal(suggestTopLevel("recipt"), "receipt"); // d=1
  assert.equal(suggestTopLevel("hello"), null); // help is d=2 but token ≤5 chars
  assert.equal(suggestTopLevel("auth"), null); // exact commands are never guarded
  assert.equal(suggestTopLevel("xyzzy"), null);
});

test("slashCompletions completes the command word only", () => {
  assert.deepEqual(slashCompletions("/mo"), [["/models", "/model"], "/mo"]);
  assert.deepEqual(slashCompletions("/q"), [["/quit"], "/q"]);
  assert.deepEqual(slashCompletions("/model son"), [[], "/model son"]);
  assert.deepEqual(slashCompletions("hi"), [[], "hi"]);
});

test("/help lists every registry command (help cannot drift from the switch)", async () => {
  const out = new Capture();
  await handleSlash(ctx, "/help", out);
  const text = out.text();
  for (const c of SLASH_COMMANDS) {
    assert.ok(text.includes(`/${c.name}`), `/help is missing /${c.name}`);
    for (const a of c.aliases ?? []) {
      assert.ok(text.includes(`/${a}`), `/help is missing alias /${a}`);
    }
  }
});

test("every registry command is actually accepted by the switch", async () => {
  // /exit and /quit return exit; everything else must not hit the unknown path.
  for (const name of slashNames()) {
    if (name === "exit" || name === "quit" || name === "help" || name === "clear") continue;
    if (["models", "agents", "model", "agent", "tier", "audit", "doctor"].includes(name)) continue; // network-backed — wiring pinned by the switch itself
    const out = new Capture();
    await handleSlash(ctx, `/${name}`, out);
    assert.ok(!out.text().includes("unknown command"), `/${name} fell through to unknown`);
  }
});

test("unknown slash command gets a did-you-mean", async () => {
  const out = new Capture();
  await handleSlash(ctx, "/modle", out);
  assert.match(out.text(), /unknown command: \/modle — did you mean \/model\?/);
  const out2 = new Capture();
  await handleSlash(ctx, "/zzzzzz", out2);
  assert.match(out2.text(), /unknown command: \/zzzzzz {2}\(\/help lists commands\)/);
});
