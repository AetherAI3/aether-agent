// Remote Control host client against a mock broker (AETHER-AGENT-LIVE-01 R2).
// The mock implements the frozen wire semantics that matter to the host:
// exclusive host attach (409), append dedupe by host_event_id, ack cursors.

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpError } from "../src/core/errors.js";
import {
  computeBackoffMs,
  RemoteHostClient,
  type RcTransport,
} from "../src/core/remote_host.js";

interface BrokerEvent { host_event_id: string; event_type: string; payload: Record<string, unknown> }

/** In-memory broker speaking the host wire protocol. */
class MockBroker implements RcTransport {
  events: BrokerEvent[] = [];
  seenEventIds = new Set<string>();
  appendCalls = 0;
  revoked: string[] = [];
  heartbeats = 0;
  networkDown = false;
  refuseSecondHost = false;
  conflictNextAppend = false;
  /** When set, the next append accepts every item EXCEPT the first, which comes
   *  back as a per-item G4 redaction rejection (2xx request, item dropped). */
  rejectFirstItemReason: string | null = null;
  lastEventsBody: { host_secret?: string; events: BrokerEvent[] } | null = null;
  lastRegisterBody: Record<string, unknown> | null = null;
  lastAttachBody: Record<string, unknown> | null = null;
  lastHeartbeatBody: Record<string, unknown> | null = null;
  private counter = 0;

  async postJson<T>(path: string, body: unknown): Promise<T> {
    if (this.networkDown) throw new Error("ECONNREFUSED (mock)");
    // R1 (#1328) routes: register posts to /remote/sessions.
    if (path === "/remote/sessions") {
      this.lastRegisterBody = body as Record<string, unknown>;
      if (this.refuseSecondHost) throw new HttpError(409, "host already attached");
      this.counter += 1;
      return {
        session_id: `rs_${this.counter}`,
        host_secret: "mock-host-secret",
        viewer_url: "https://viewer.invalid/code/rc/session",
        redemption_url: "https://viewer.invalid/code/rc/redeem/red_1",
        grant_token: "grant-single-use",
        expires_at: "2026-08-24T00:00:00.000Z",
      } as T;
    }
    if (path.endsWith("/host/attach")) {
      this.lastAttachBody = body as Record<string, unknown>;
      if (this.refuseSecondHost) throw new HttpError(409, "host already attached");
      return { viewer_url: "https://viewer.invalid/code/rc/session" } as T;
    }
    if (path.endsWith("/host/heartbeat")) {
      this.lastHeartbeatBody = body as Record<string, unknown>;
      this.heartbeats += 1;
      return {} as T;
    }
    if (path.endsWith("/host/events")) {
      this.appendCalls += 1;
      this.lastEventsBody = body as { host_secret?: string; events: BrokerEvent[] };
      if (this.conflictNextAppend) {
        this.conflictNextAppend = false;
        throw new HttpError(409, "EventConflictError"); // G2 payload-bound idempotency
      }
      const batch = this.lastEventsBody.events;
      const reason = this.rejectFirstItemReason;
      this.rejectFirstItemReason = null;
      const receipts = batch.map((event, index) => {
        if (reason && index === 0) return { host_event_id: event.host_event_id, rejected: true, reason };
        if (this.seenEventIds.has(event.host_event_id)) {
          // Dedupe: return the original seq, do not re-store.
          return { host_event_id: event.host_event_id, seq: this.events.findIndex((e) => e.host_event_id === event.host_event_id) + 1 };
        }
        this.seenEventIds.add(event.host_event_id);
        this.events.push(event);
        return { host_event_id: event.host_event_id, seq: this.events.length };
      });
      return { receipts, acked_seq: this.events.length } as T;
    }
    if (path.endsWith("/revoke")) {
      this.revoked.push(path);
      return {} as T;
    }
    throw new HttpError(404, `unknown mock path ${path}`);
  }
}

function tempStatePath(): string {
  return join(mkdtempSync(join(tmpdir(), "aether-rc-")), "host-state.json");
}

function client(broker: MockBroker, statePath: string, extra: Partial<ConstructorParameters<typeof RemoteHostClient>[0]> = {}): RemoteHostClient {
  return new RemoteHostClient({
    transport: broker,
    statePath,
    projectRoot: "C:\\proj",
    env: {},
    heartbeatMs: 60_000,
    random: () => 0.5,
    ...extra,
  });
}

test("register, publish, flush: events land once and the cursor advances", async () => {
  const broker = new MockBroker();
  const host = client(broker, tempStatePath());
  const status = await host.start({ sessionName: "demo" });
  assert.equal(status.phase, "active");
  assert.equal(status.viewerUrl, "https://viewer.invalid/code/rc/session");
  assert.equal(status.redemptionUrl, "https://viewer.invalid/code/rc/redeem/red_1");

  assert.equal(host.publish("tool_activity", { tool: "write_file", target: "src/app.ts", status: "ok" }), true);
  assert.equal(host.publish("done", { status: "passed", summary: "all green" }), true);
  await host.flush();

  assert.equal(broker.events.length, 2);
  assert.equal(host.status().pendingEvents, 0);
  assert.equal(host.status().lastAckedSeq, 2);
  // R1 (#1328) /host/events authenticates the append with the host_secret.
  assert.equal(broker.lastEventsBody?.host_secret, "mock-host-secret");
  host.stopLocal();
});

test("register, attach, and heartbeat all carry the device_id (R1 RemoteHostAttach, extra=forbid)", async () => {
  const broker = new MockBroker();
  const statePath = tempStatePath();
  const first = client(broker, statePath, { deviceId: "dev_fixed", heartbeatMs: 20 });
  assert.equal((await first.start()).phase, "active");
  assert.equal(broker.lastRegisterBody?.["device_id"], "dev_fixed");
  // Let one heartbeat fire; its body must carry device_id or R1 would 422.
  await new Promise((resolve) => setTimeout(resolve, 60));
  first.stopLocal();
  assert.equal(broker.lastHeartbeatBody?.["device_id"], "dev_fixed");
  assert.ok(broker.heartbeats >= 1, "a heartbeat actually fired");

  // A resumed session re-attaches presenting the SAME persisted device id.
  const second = client(broker, statePath, { deviceId: "dev_ignored_on_resume", heartbeatMs: 60_000 });
  assert.equal((await second.start()).phase, "active");
  assert.equal(broker.lastAttachBody?.["device_id"], "dev_fixed");
  second.stopLocal();
});

test("an untyped per-item rejection preserves the complete durable batch", async () => {
  const broker = new MockBroker();
  const host = client(broker, tempStatePath());
  await host.start();
  broker.rejectFirstItemReason = "redaction";
  host.publish("transcript", { role: "agent", summary: "first" });
  host.publish("transcript", { role: "agent", summary: "second" });
  await host.flush();
  // Until the shared Cloud fixture identifies a typed, event-scoped terminal
  // error, the host cannot safely decide which local event to quarantine.
  assert.equal(host.status().phase, "failed");
  assert.equal(host.status().pendingEvents, 2);
  assert.equal(host.status().droppedEvents, 0);
  assert.equal(broker.events.length, 1);
  assert.equal(broker.events[0]!.payload["summary"], "second");
  host.stopLocal();
});

test("a generic events 409 preserves the batch until its typed error is known", async () => {
  const broker = new MockBroker();
  const host = client(broker, tempStatePath());
  await host.start();
  broker.conflictNextAppend = true;
  host.publish("transcript", { role: "agent", summary: "conflicting content" });
  await host.flush();
  assert.equal(host.status().phase, "failed");
  assert.equal(host.status().pendingEvents, 1);
  assert.equal(host.status().droppedEvents, 0);
  assert.match(host.status().detail ?? "", /outbox was preserved/);
  assert.equal(broker.events.length, 0);
  host.stopLocal();
});

test("an event is never sent when its durable outbox write fails", async () => {
  const broker = new MockBroker();
  const statePath = tempStatePath();
  const host = client(broker, statePath);
  assert.equal((await host.start()).phase, "active");
  // Replace the state file with a directory after registration so the next
  // atomic rename cannot commit the queued event.
  unlinkSync(statePath);
  mkdirSync(statePath);
  assert.equal(host.publish("done", { status: "passed" }), false);
  await host.flush();
  assert.equal(host.status().pendingEvents, 0);
  assert.equal(host.status().droppedEvents, 1);
  assert.match(host.status().detail ?? "", /durable Remote Control outbox/);
  assert.equal(broker.events.length, 0);
  host.stopLocal();
});

test("registration does not activate when the one-time host credential cannot be persisted", async () => {
  const broker = new MockBroker();
  const statePath = mkdtempSync(join(tmpdir(), "aether-rc-unwritable-state-"));
  const host = client(broker, statePath);
  const status = await host.start();
  assert.equal(status.phase, "failed");
  assert.match(status.detail ?? "", /securely persist/);
  assert.equal(host.publish("done", { status: "passed" }), false);
  assert.equal(broker.events.length, 0);
});

test("outbox survives an outage and replays WITHOUT duplicates (host_event_id dedupe)", async () => {
  const broker = new MockBroker();
  const statePath = tempStatePath();
  const first = client(broker, statePath);
  assert.equal((await first.start()).phase, "active");

  broker.networkDown = true;
  first.publish("transcript", { role: "agent", summary: "step one" });
  first.publish("transcript", { role: "agent", summary: "step two" });
  first.publish("transcript", { role: "agent", summary: "step three" });
  await first.flush();
  assert.equal(first.status().phase, "reconnecting");
  assert.equal(first.status().pendingEvents, 3);
  first.stopLocal(); // process "crashes"/exits with an unflushed outbox

  // Keep a copy of the durable state to simulate the flaky-connection case
  // where the SAME batch is transmitted twice.
  const replayCopy = statePath + ".replay";
  copyFileSync(statePath, replayCopy);

  broker.networkDown = false;
  const second = client(broker, statePath);
  assert.equal((await second.start()).phase, "active"); // re-attach, resume from cursor
  await second.flush();
  assert.equal(broker.events.length, 3);
  second.stopLocal();

  // A third host resumes from the stale pre-flush cursor and re-sends the
  // same host_event_ids: the broker dedupes, so nothing is duplicated.
  const third = client(broker, replayCopy);
  assert.equal((await third.start()).phase, "active");
  await third.flush();
  assert.ok(broker.appendCalls >= 2, "the batch really was transmitted more than once");
  assert.equal(broker.events.length, 3, "duplicate transmission must not duplicate events");
  const summaries = broker.events.map((event) => event.payload["summary"]);
  assert.deepEqual(summaries, ["step one", "step two", "step three"]);
  third.stopLocal();
});

test("a second host is refused with 409 and the client fails gracefully", async () => {
  const broker = new MockBroker();
  broker.refuseSecondHost = true;
  const host = client(broker, tempStatePath());
  const status = await host.start();
  assert.equal(status.phase, "failed");
  assert.match(status.detail ?? "", /exclusive host/);
  // Fail-soft: publishing afterwards is a no-op, never a throw.
  assert.equal(host.publish("done", { status: "passed" }), false);
});

test("broker loss mid-session degrades to reconnecting and never throws (local session unaffected)", async () => {
  const broker = new MockBroker();
  const host = client(broker, tempStatePath());
  await host.start();
  broker.networkDown = true;
  assert.equal(host.publish("tests", { status: "running", passed: 1, failed: 0 }), true);
  await host.flush();
  const status = host.status();
  assert.equal(status.phase, "reconnecting");
  assert.equal(status.pendingEvents, 1);
  assert.match(status.detail ?? "", /local session is unaffected/);
  // Recovery: the broker returns and the queued event is delivered.
  broker.networkDown = false;
  await host.flush();
  assert.equal(host.status().phase, "active");
  assert.equal(broker.events.length, 1);
  host.stopLocal();
});

test("/rc off revokes at the broker, clears durable state, and does not end the process", async () => {
  const broker = new MockBroker();
  const statePath = tempStatePath();
  const host = client(broker, statePath);
  await host.start();
  assert.equal(existsSync(statePath), true);

  const status = await host.off();
  assert.equal(status.phase, "off");
  assert.equal(broker.revoked.length, 1);
  assert.equal(existsSync(statePath), false);
  // The local session (this test process) is alive and RC is inert.
  assert.equal(host.publish("done", { status: "passed" }), false);
});

test("/rc off with the broker down retains a retryable revocation tombstone", async () => {
  const broker = new MockBroker();
  const statePath = tempStatePath();
  const host = client(broker, statePath);
  await host.start();
  broker.networkDown = true;
  const status = await host.off();
  assert.equal(status.phase, "failed");
  assert.equal(existsSync(statePath), true, "the session handle must survive for a revoke retry");
  assert.match(status.detail ?? "", /revocation is unconfirmed/);
  assert.equal(host.publish("done", { status: "passed" }), false, "the local relay stays stopped");

  // A fresh process must not accidentally resume a session the user asked to
  // revoke. It can still retry `/rc off` once the broker recovers.
  const fresh = client(broker, statePath);
  const refusedResume = await fresh.start();
  assert.equal(refusedResume.phase, "failed");
  assert.match(refusedResume.detail ?? "", /retry `\/rc off`/);
  broker.networkDown = false;
  const retried = await fresh.off();
  assert.equal(retried.phase, "off");
  assert.equal(existsSync(statePath), false);
});

test("reconnect backoff: 1 s doubling to the 60 s cap, jitter within ±25 %", () => {
  const mid = (attempt: number): number => computeBackoffMs(attempt, () => 0.5);
  assert.equal(mid(0), 1_000);
  assert.equal(mid(1), 2_000);
  assert.equal(mid(2), 4_000);
  assert.equal(mid(5), 32_000);
  assert.equal(mid(6), 60_000);
  assert.equal(mid(20), 60_000); // capped, no overflow
  for (const attempt of [0, 3, 6]) {
    const base = Math.min(60_000, 1_000 * 2 ** attempt);
    assert.equal(computeBackoffMs(attempt, () => 0), Math.round(base * 0.75));
    assert.equal(computeBackoffMs(attempt, () => 1), Math.round(base * 1.25));
  }
  assert.ok(computeBackoffMs(0, () => 0) >= 250);
});

test("forbidden payload fields never reach the broker (allowlist applied before queueing)", async () => {
  const broker = new MockBroker();
  const host = client(broker, tempStatePath());
  await host.start();
  host.publish("tool_activity", {
    tool: "run_shell",
    target: "C:\\proj\\scripts\\build.ps1",
    env: { AETHER_TOKEN: "supersecret" },
    token: "supersecret",
    file_contents: "the entire file",
    shell_history: ["rm -rf /"],
    cookies: "session=abc",
    mcp_credentials: { key: "k" },
    hidden_prompt: "system text",
  });
  await host.flush();
  assert.equal(broker.events.length, 1);
  const sent = broker.events[0]!.payload;
  assert.deepEqual(Object.keys(sent).sort(), ["target", "tool"]);
  assert.equal(sent["target"], "scripts/build.ps1"); // project-relative, never absolute
  assert.ok(!JSON.stringify(sent).includes("supersecret"));
  host.stopLocal();
});
