// `/rc` command surface: registry wiring, honest failure without auth, start
// display (URL + QR), status indicators, and off-without-killing-the-session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { AppContext } from "../src/core/context.js";
import { findCommand } from "../src/commands/slash_registry.js";
import { findCliCommand, findDispatchedCliCommand } from "../src/commands/cli_registry.js";
import { COMMAND_RELEASE_CONTRACT } from "../src/commands/command_manifest.js";
import { cmdRc, RC_EXIT, rcStatePath } from "../src/commands/rc.js";
import { RemoteHostClient, setRemoteHost, type RcTransport } from "../src/core/remote_host.js";

function sink(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  let value = "";
  stream.on("data", (chunk) => { value += String(chunk); });
  return { stream, text: () => value };
}

function context(token: string | null): AppContext {
  return {
    cfg: {} as AppContext["cfg"],
    api: {} as AppContext["api"],
    tokens: { get: async () => token } as unknown as AppContext["tokens"],
    flags: { cwd: mkdtempSync(join(tmpdir(), "aether-rc-cmd-")), yes: true, json: false, audit: false },
    confirm: async () => true,
  };
}

const okTransport: RcTransport = {
  async postJson<T>(path: string): Promise<T> {
    if (path === "/remote-sessions") {
      return {
        session_id: "rs_cmd", viewer_url: "https://viewer.invalid/code/rc/s",
        redemption_url: "https://viewer.invalid/r/red_9", expires_at: "2026-08-24T00:00:00.000Z",
      } as T;
    }
    return {} as T;
  },
};

function host(statePath: string): RemoteHostClient {
  return new RemoteHostClient({ transport: okTransport, statePath, projectRoot: "C:\\proj", env: {}, heartbeatMs: 60_000 });
}

test("rc is registered on both surfaces with a release disposition", () => {
  assert.equal(findCommand("rc")?.section, "Session");
  assert.equal(findCliCommand("rc")?.name, "rc");
  assert.ok(findDispatchedCliCommand("rc"), "rc must be self-dispatching");
  assert.equal(COMMAND_RELEASE_CONTRACT.get("shell:rc")?.disposition, "new");
  assert.equal(COMMAND_RELEASE_CONTRACT.get("slash:rc")?.disposition, "new");
});

test("rc status with no host reports off and exits 0", async () => {
  setRemoteHost(null);
  const out = sink();
  const code = await cmdRc(context("tok"), ["status"], { out: out.stream, err: out.stream });
  assert.equal(code, RC_EXIT.ok);
  assert.match(out.text(), /Remote Control: .*off/);
});

test("rc start without a signed-in session refuses honestly and leaves the session alone", async () => {
  setRemoteHost(null);
  const out = sink();
  const err = sink();
  const code = await cmdRc(context(null), [], { out: out.stream, err: err.stream });
  assert.equal(code, RC_EXIT.failed);
  assert.match(err.text(), /aether auth login/);
  assert.match(err.text(), /local session keeps working/);
});

test("rc start shows the viewer URL, a QR block, expiry, and the revoke control", async () => {
  setRemoteHost(null);
  const out = sink();
  const statePath = join(mkdtempSync(join(tmpdir(), "aether-rc-cmd-")), "state.json");
  const code = await cmdRc(context("tok"), ["my", "session"], {
    out: out.stream, err: out.stream, host: host(statePath), wait: false,
  });
  assert.equal(code, RC_EXIT.ok);
  const text = out.text();
  assert.match(text, /Remote Control: .*active.*my session/);
  assert.match(text, /https:\/\/viewer\.invalid\/code\/rc\/s/);
  assert.match(text, /expires\s+2026-08-24/);
  assert.ok(text.includes("█"), "a terminal QR block is rendered");
  assert.match(text, /single-use/);
  assert.match(text, /\/rc off/);
  // ...and the running host now answers /rc status.
  const statusOut = sink();
  await cmdRc(context("tok"), ["status"], { out: statusOut.stream, err: statusOut.stream });
  assert.match(statusOut.text(), /active/);
  // Cleanup for test isolation (the suite runs in one process).
  await cmdRc(context("tok"), ["off"], { out: sink().stream, err: sink().stream });
});

test("rc off revokes and the command (the local session's process) carries on", async () => {
  setRemoteHost(null);
  const statePath = join(mkdtempSync(join(tmpdir(), "aether-rc-cmd-")), "state.json");
  const h = host(statePath);
  await h.start({});
  setRemoteHost(h);
  const out = sink();
  const code = await cmdRc(context("tok"), ["off"], { out: out.stream, err: out.stream });
  assert.equal(code, RC_EXIT.ok);
  assert.match(out.text(), /revoked/i);
  assert.match(out.text(), /local session is unaffected/);
  // The process is demonstrably still running: a follow-up status works.
  const statusOut = sink();
  await cmdRc(context("tok"), ["status"], { out: statusOut.stream, err: statusOut.stream });
  assert.match(statusOut.text(), /off/);
});

test("usage errors exit 2 and state paths are per-project and stable", async () => {
  const err = sink();
  const code = await cmdRc(context("tok"), ["status", "extra"], { out: err.stream, err: err.stream });
  assert.equal(code, RC_EXIT.usage);
  assert.equal(rcStatePath("C:\\proj"), rcStatePath("C:\\proj"));
  assert.notEqual(rcStatePath("C:\\proj"), rcStatePath("C:\\other"));
});
