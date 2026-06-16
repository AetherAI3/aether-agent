import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoSpec, cloneArgs, prCreateHint } from "../src/core/repo.js";

test("parseRepoSpec accepts owner/name", () => {
  const s = parseRepoSpec("octocat/hello-world");
  assert.equal(s.owner, "octocat");
  assert.equal(s.name, "hello-world");
  assert.equal(s.full, "octocat/hello-world");
});

test("parseRepoSpec strips github URL forms and .git", () => {
  assert.equal(parseRepoSpec("https://github.com/octocat/hello-world.git").full, "octocat/hello-world");
  assert.equal(parseRepoSpec("git@github.com:octocat/hello-world").full, "octocat/hello-world");
  assert.equal(parseRepoSpec("octocat/hello-world/").full, "octocat/hello-world");
});

test("parseRepoSpec rejects junk", () => {
  assert.throws(() => parseRepoSpec("not-a-repo"), /expected owner\/name/);
  assert.throws(() => parseRepoSpec("a/b/c"), /expected owner\/name/);
  assert.throws(() => parseRepoSpec(""), /expected owner\/name/);
});

test("parseRepoSpec rejects argument-injection segments (leading dash, '.'/'..')", () => {
  assert.throws(() => parseRepoSpec("-x/y"), /may not start with '-'/);
  assert.throws(() => parseRepoSpec("x/-y"), /may not start with '-'/);
  assert.throws(() => parseRepoSpec("../y"), /'\.'\/'\.\.'/);
  assert.throws(() => parseRepoSpec("a/.."), /'\.'\/'\.\.'/);
  assert.throws(() => parseRepoSpec("./y"), /'\.'\/'\.\.'/);
  // Legit names containing dots/dashes (not leading) still parse.
  assert.equal(parseRepoSpec("my.org/my-repo.js").full, "my.org/my-repo.js");
});

test("cloneArgs uses gh when available, git otherwise", () => {
  const s = parseRepoSpec("octocat/hello-world");
  assert.deepEqual(cloneArgs(s, "/d", true), { cmd: "gh", args: ["repo", "clone", "octocat/hello-world", "/d"] });
  assert.deepEqual(cloneArgs(s, "/d", false), {
    cmd: "git",
    args: ["clone", "https://github.com/octocat/hello-world.git", "/d"],
  });
});

test("prCreateHint targets the repo + branch", () => {
  const hint = prCreateHint(parseRepoSpec("octocat/hello-world"), "aether/fix-1");
  assert.match(hint, /gh pr create -R octocat\/hello-world --head aether\/fix-1 --fill/);
});
