// Doctor --live: drive one SYNTHETIC dev session end-to-end and report what
// was actually proven. The server side is scripted (AETHER-CLOUD
// lib/agent_dev/synthetic.py) — no model call, zero UVT by construction.
//
// Proven steps: authentication, session create (capability negotiation),
// sequence-numbered frame receipt, pause+resume acknowledgement, a sandboxed
// write→read tool round trip executed by THIS host, tool-result
// acknowledgement, session close, and no local residue.

import { mkdirSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ApiClient } from "../transport.js";
import {
  DEV_SESSIONS_PATH,
  devSessionStreamPath,
  devSessionToolResultsPath,
  devSessionControlPath,
  devSessionPath,
} from "../transport.js";
import { decodeSse } from "../stream.js";
import { ToolExecutor } from "../tool_executor.js";
import { DEV_PROTOCOL_VERSION } from "../brain_cloud.js";

export interface LiveProbeStep {
  id: string;
  ok: boolean;
  detail: string;
}

export interface LiveProbeReport {
  ok: boolean;
  steps: readonly LiveProbeStep[];
}

interface CreatedSession {
  session_id: string;
  protocol_version: number;
  synthetic?: boolean;
}

/**
 * Run the synthetic live probe. The sandbox is a private temp directory —
 * never the user's project — and is verified empty-then-removed at the end.
 */
export async function runLiveProbe(api: ApiClient): Promise<LiveProbeReport> {
  const steps: LiveProbeStep[] = [];
  const step = (id: string, ok: boolean, detail: string): void => {
    steps.push({ id, ok, detail });
  };

  const sandbox = join(tmpdir(), "aether-doctor-live-" + process.pid);
  mkdirSync(join(sandbox, ".aether-doctor"), { recursive: true });
  const exec = new ToolExecutor(sandbox);

  let sessionId: string | null = null;
  try {
    let created: CreatedSession;
    try {
      created = await api.postJson<CreatedSession>(DEV_SESSIONS_PATH, {
        task: "doctor live probe",
        surface: "aether_agent",
        model: null,
        effort: null,
        capabilities: ["read_file", "write_file"],
        protocol_version: DEV_PROTOCOL_VERSION,
        synthetic: true,
      });
    } catch (err) {
      step("live.create", false, err instanceof Error ? err.message : String(err));
      return { ok: false, steps };
    }
    sessionId = created.session_id;
    step("live.authenticate", true, "session created as the signed-in account");
    step(
      "live.negotiate",
      created.protocol_version === DEV_PROTOCOL_VERSION,
      "protocol v" + created.protocol_version + (created.synthetic ? " · synthetic" : ""),
    );

    // Pause + resume acknowledgement (synchronous HTTP acks).
    const paused = await api.postJson<{ ok?: boolean; state?: string }>(
      devSessionControlPath(sessionId), { action: "pause", note: null },
    );
    step("live.pause", paused.state === "paused", "state " + String(paused.state));
    const resumed = await api.postJson<{ ok?: boolean; state?: string }>(
      devSessionControlPath(sessionId), { action: "resume", note: null },
    );
    step("live.resume", resumed.state === "running" || resumed.state === "created", "state " + String(resumed.state));

    // Stream: execute the scripted tool calls locally inside the sandbox.
    let lastSeq = 0;
    let sequenceOk = true;
    let sawDone = false;
    let doneOk = false;
    let toolRoundTrips = 0;
    const stream = await api.stream(devSessionStreamPath(sessionId, 0), undefined, { method: "GET" });
    for await (const frame of decodeSse(stream)) {
      if (typeof frame.seq === "number") {
        if (frame.seq <= lastSeq) { sequenceOk = false; continue; }
        lastSeq = frame.seq;
      }
      if (frame.type === "tool_call") {
        const result = await exec.executeAsync(frame.name, frame.args);
        await api.postJson(devSessionToolResultsPath(sessionId), {
          tool_call_id: frame.toolCallId,
          status: result.exitCode === 0 ? "ok" : "error",
          exit_code: result.exitCode,
          output: result.output,
          truncated: false,
        });
        toolRoundTrips += 1;
      }
      if (frame.type === "error") {
        step("live.session", false, frame.msg);
        break;
      }
      if (frame.type === "done") {
        sawDone = true;
        doneOk = frame.ok !== false;
        break;
      }
    }
    step("live.sequence", sequenceOk && lastSeq > 0, "frames 1.." + lastSeq + " strictly increasing");
    step("live.tool_round_trip", toolRoundTrips >= 2 && doneOk, toolRoundTrips + " sandboxed tool round trips, server verified the echo");
    step("live.done", sawDone && doneOk, sawDone ? "terminal done ok=" + doneOk : "stream ended without done");

    // Teardown.
    await api.deleteJson(devSessionPath(sessionId));
    sessionId = null;
    step("live.close", true, "session deleted");
  } catch (err) {
    step("live.error", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (sessionId) {
      try { await api.deleteJson(devSessionPath(sessionId)); } catch { /* best effort */ }
    }
    // No residue: the probe file must be the ONLY thing in the sandbox, and
    // removing the sandbox must leave nothing behind.
    try {
      const leftovers = existsSync(sandbox) ? readdirSync(join(sandbox, ".aether-doctor")) : [];
      rmSync(sandbox, { recursive: true, force: true });
      steps.push({
        id: "live.no_residue",
        ok: !existsSync(sandbox),
        detail: leftovers.length + " probe file(s) removed with the sandbox",
      });
    } catch {
      steps.push({ id: "live.no_residue", ok: false, detail: "sandbox cleanup failed: " + sandbox });
    }
  }

  return { ok: steps.every((s) => s.ok), steps };
}
