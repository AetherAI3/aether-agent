import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AppContext } from "../src/core/context.js";
import {
  commandDigest, isLoopbackUrl, parsePreviewState, previewPaths, resolvePreviewCwd, sanitizePreviewText,
  validatePreviewCommand, PREVIEW_SCHEMA, type PreviewState,
} from "../src/core/preview_contract.js";
import { cmdPreview, PREVIEW_EXIT, resolvePreviewCommand } from "../src/commands/preview.js";

function tempProject(): string { return mkdtempSync(join(tmpdir(), "aether-preview-")); }
function sink(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough(); let value = "";
  stream.on("data", (chunk) => { value += String(chunk); });
  return { stream, text: () => value };
}
function context(cwd: string, yes = true): AppContext {
  return {
    cfg: {} as AppContext["cfg"], api: {} as AppContext["api"], tokens: {} as AppContext["tokens"],
    flags: { cwd, yes, json: false, audit: false }, confirm: async () => yes,
  };
}

test("preview contract accepts loopback only and strips hostile terminal controls", () => {
  for (const url of ["http://127.0.0.1:3000", "https://localhost:5173/x", "http://[::1]:8080"]) assert.equal(isLoopbackUrl(url), true);
  for (const url of ["http://0.0.0.0:3000", "http://192.168.1.2:3000", "file:///tmp/x", "http://user:pw@localhost:1", "http://localhost:1\nX"]) assert.equal(isLoopbackUrl(url), false);
  assert.equal(sanitizePreviewText("ok\u001b]0;owned\u0007\u001b[31m red\u001b[0m\u0000\n"), "ok red\n");
  assert.equal(sanitizePreviewText("token=preview-secret-value\n"), "token=[REDACTED]\n");
});

test("preview command validation confines cwd and rejects hostile argv", () => {
  const root = tempProject(); mkdirSync(join(root, "app"));
  const command = validatePreviewCommand({ executable: "npm", args: ["run", "dev"], cwd: "app", readyUrl: "http://localhost:3000", timeoutMs: 1000 }, root);
  assert.equal(command.cwd, join(root, "app"));
  assert.equal(commandDigest(command), commandDigest({ ...command }));
  assert.throws(() => resolvePreviewCwd(root, ".."), /inside the project/);
  assert.throws(() => validatePreviewCommand({ executable: "npm\ncalc", args: [], cwd: ".", timeoutMs: 1000 }, root), /control/);
  assert.throws(() => validatePreviewCommand({ executable: "npm", args: ["x\n--evil"], cwd: ".", timeoutMs: 1000 }, root), /controls/);
  assert.throws(() => validatePreviewCommand({ executable: "npm", args: ["run", "dev", "--host=0.0.0.0"], cwd: ".", timeoutMs: 1000 }, root), /wildcard/);
});

test("project declaration is explicit, bounded, and cannot be a symlink", () => {
  const root = tempProject(); mkdirSync(join(root, ".aether"));
  assert.throws(() => resolvePreviewCommand(root, {}), /preview.json is absent/);
  writeFileSync(join(root, ".aether", "declared.json"), JSON.stringify({ version: 1, command: "npm", args: ["run", "dev"] }));
  symlinkSync(join(root, ".aether", "declared.json"), join(root, ".aether", "preview.json"));
  assert.throws(() => resolvePreviewCommand(root, {}), /unsafe/);
});

test("preview state directory rejects a planted junction/symlink", () => {
  const root = tempProject(); const outside = tempProject();
  symlinkSync(outside, join(root, ".aether"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => previewPaths(root), /symlink|junction/);
});

test("managed preview detects its URL, reports headless honestly, sanitizes logs, and stops descendants", { timeout: 30_000 }, async () => {
  const root = tempProject();
  const heartbeat = join(root, "heartbeat.txt");
  const secret = "preview-secret-value-12345";
  const script = join(root, "server.mjs");
  writeFileSync(script, `
    import { createServer } from "node:http";
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    if (process.argv[2] === "beat") {
      setInterval(()=>writeFileSync(process.argv[3],String(Date.now())),80);
    } else {
      const beat = spawn(process.execPath,[process.argv[1],"beat",process.argv[3]],{stdio:"ignore"});
      const s=createServer((_q,r)=>r.end("ok"));
      s.listen(0,"127.0.0.1",()=>{const a=s.address();console.log("\\u001b]0;hostile\\u0007ready http://127.0.0.1:"+a.port);console.log("grand "+beat.pid);console.log("token="+process.argv[5])});
      setInterval(()=>{},1000);
    }
  `);
  const previewArgs = [script, "serve", heartbeat, "--api-key", secret];
  const out = sink(); const err = sink();
  const start = await cmdPreview(context(root), ["start"], { command: process.execPath, args: previewArgs, timeoutMs: "8000", noOpen: true, out: out.stream, err: err.stream });
  assert.equal(start, PREVIEW_EXIT.ok, err.text());
  assert.match(out.text(), /^http:\/\/127\.0\.0\.1:\d+/m);
  assert.match(out.text(), /Browser not opened/);
  assert.doesNotMatch(out.text(), /Opened in/);
  assert.doesNotMatch(err.text(), new RegExp(secret));

  const paths = previewPaths(root);
  const stateText = readFileSync(paths.statePath, "utf8");
  assert.doesNotMatch(stateText, /"token"/);
  assert.doesNotMatch(stateText, new RegExp(secret));
  assert.deepEqual(readdirSync(paths.dir).filter((name) => name.startsWith("launch-") || name === "control.json"), []);
  const state = JSON.parse(stateText) as PreviewState;
  assert.equal(parsePreviewState({ ...state, token: secret }), null, "legacy or injected bearer state was accepted");
  const csrf = await fetch(`http://127.0.0.1:${state.controlPort}/stop`, { method: "POST" });
  assert.equal(csrf.status, 403, "a browser-simple request reached preview control without the custom header");
  const forged = await fetch(`http://127.0.0.1:${state.controlPort}/stop`, {
    method: "POST", headers: { "x-aether-preview-control": "00000000-0000-4000-8000-000000000000" },
  });
  assert.equal(forged.status, 403, "a control id without an owner-private request file was accepted");

  const blockedId = "11111111-1111-4111-8111-111111111111";
  const controlPath = join(paths.dir, "control.json");
  writeFileSync(controlPath, JSON.stringify({
    schema: PREVIEW_SCHEMA, requestId: blockedId, instanceId: "wrong-instance", method: "POST", path: "/stop",
  }), { mode: 0o600 });
  const invalid = await fetch(`http://127.0.0.1:${state.controlPort}/stop`, {
    method: "POST", headers: { "x-aether-preview-control": blockedId },
  });
  assert.equal(invalid.status, 403);
  assert.equal(existsSync(controlPath), true, "supervisor consumed a request before validating ownership");
  const busyOut = sink(); const busyErr = sink();
  assert.equal(await cmdPreview(context(root), ["status"], { out: busyOut.stream, err: busyErr.stream }), PREVIEW_EXIT.controlFailed);
  assert.match(busyErr.text(), /control is busy/);
  assert.equal(existsSync(paths.statePath), true, "busy control was misclassified as stale and deleted");
  assert.equal(existsSync(controlPath), true, "a losing caller deleted a request it did not own");
  assert.doesNotThrow(() => process.kill(state.childPid, 0), "busy control orphaned or stopped the managed preview");
  unlinkSync(controlPath);

  const statusOut = sink();
  assert.equal(await cmdPreview(context(root), ["status"], { out: statusOut.stream, err: err.stream }), 0);
  assert.match(statusOut.text(), /^ready  pid=\d+  http:\/\//);
  const failedOpenOut = sink(); const failedOpenErr = sink();
  assert.equal(await cmdPreview(context(root), ["open"], {
    out: failedOpenOut.stream, err: failedOpenErr.stream,
    open: () => ({ status: "spawn-error", detail: "launcher missing" }),
  }), PREVIEW_EXIT.controlFailed);
  assert.match(failedOpenOut.text(), /^http:\/\//);
  assert.match(failedOpenErr.text(), /Browser was not opened.*launcher missing/);
  assert.doesNotMatch(failedOpenOut.text(), /Opened|launch requested/);
  const attachOut = sink();
  assert.equal(await cmdPreview(context(root), ["start"], {
    command: process.execPath, args: previewArgs, timeoutMs: "8000", noOpen: true,
    out: attachOut.stream, err: err.stream,
  }), 0);
  assert.match(attachOut.text(), /Attached to declared preview/);
  assert.equal(await cmdPreview(context(root), ["start"], {
    command: process.execPath, args: [...previewArgs, "different"], timeoutMs: "8000", noOpen: true,
    out: attachOut.stream, err: err.stream,
  }), PREVIEW_EXIT.controlFailed);
  assert.match(err.text(), /different declared preview/);
  const logs = sink();
  assert.equal(await cmdPreview(context(root), ["logs"], { out: logs.stream, err: err.stream }), 0);
  assert.match(logs.text(), /ready http:\/\//);
  assert.doesNotMatch(logs.text(), /\u001b|hostile/);
  assert.doesNotMatch(logs.text(), new RegExp(secret));
  assert.match(logs.text(), /token=\[REDACTED\]/);

  assert.equal(await cmdPreview(context(root), ["stop"], { out: out.stream, err: err.stream }), 0, err.text());
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  const first = statSync(heartbeat).mtimeMs;
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  assert.equal(statSync(heartbeat).mtimeMs, first, "grandchild heartbeat survived preview stop");
});

test("port hijack and early exit never become ready", { timeout: 15_000 }, async () => {
  const root = tempProject();
  const hijacker = createServer((_q, res) => res.end("other process"));
  await new Promise<void>((resolvePromise) => hijacker.listen(0, "127.0.0.1", () => resolvePromise()));
  const address = hijacker.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const script = join(root, "collision.mjs");
  writeFileSync(script, `import{createServer}from"node:http";console.log(${JSON.stringify(url)});const s=createServer();s.on("error",()=>process.exit(19));s.listen(${address.port},"127.0.0.1");`);
  const out = sink(); const err = sink();
  const code = await cmdPreview(context(root), ["start"], { command: process.execPath, args: [script], readyUrl: url, timeoutMs: "3000", noOpen: true, out: out.stream, err: err.stream });
  assert.equal(code, PREVIEW_EXIT.launchFailed);
  assert.match(err.text(), /exited before readiness/);
  await new Promise<void>((resolvePromise) => hijacker.close(() => resolvePromise()));
});

test("launch failure is explicit and stale state never causes a PID signal", { timeout: 10_000 }, async () => {
  const root = tempProject(); const out = sink(); const err = sink();
  const failed = await cmdPreview(context(root), ["start"], { command: join(root, "absent-executable"), timeoutMs: "2000", noOpen: true, out: out.stream, err: err.stream });
  assert.equal(failed, PREVIEW_EXIT.launchFailed);
  assert.match(err.text(), /launch failed|exited before readiness/i);

  const paths = previewPaths(root);
  const stale: PreviewState = {
    schema: PREVIEW_SCHEMA, instanceId: "stale", projectRoot: root, commandDigest: "a".repeat(64),
    phase: "ready", supervisorPid: process.pid, childPid: process.pid, controlPort: 9,
    startedAt: new Date().toISOString(), url: "http://127.0.0.1:9",
  };
  writeFileSync(paths.statePath, JSON.stringify(stale));
  const stop = await cmdPreview(context(root), ["stop"], { out: out.stream, err: err.stream });
  assert.equal(stop, PREVIEW_EXIT.notRunning);
  assert.match(err.text(), /no process was signalled/);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});
