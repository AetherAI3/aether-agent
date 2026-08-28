import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OllamaBrain } from "./brain_ollama.js";
import { LineBuffer, TOOLS, type BrainEvent, type ToolName } from "./brain_protocol.js";
import type { BrainControlResult, TaskCommand } from "./brain.js";

type ChildMode = "ollama" | "selftest";

function emit(event: BrainEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

export function runHeadlessBrainChild(mode: ChildMode): void {
  const lines = new LineBuffer();
  let brain: OllamaBrain | null = null;
  let started = false;
  let selftestState: "running" | "paused" | "closed" = "closed";
  let selftestTimer: NodeJS.Timeout | null = null;
  const finishSelftest = (): void => {
    if (selftestState !== "running") return;
    selftestState = "closed";
    emit({ type: "done", ok: true, result: "bundled child protocol selftest complete", remaining: 0, reason: "" });
  };
  const scheduleSelftest = (): void => {
    if (selftestTimer) clearTimeout(selftestTimer);
    selftestTimer = setTimeout(finishSelftest, 100);
  };
  const selftestControl = (action: "pause" | "resume" | "steer", note?: string): BrainControlResult => {
    if (selftestState === "closed") return { accepted: false, state: "closed", error: "selftest child is not running" };
    if (action === "pause") {
      if (selftestState === "paused") return { accepted: false, state: "paused", error: "selftest child is already paused" };
      selftestState = "paused";
      if (selftestTimer) clearTimeout(selftestTimer);
      selftestTimer = null;
      return { accepted: true, state: "paused" };
    }
    if (action === "resume") {
      if (selftestState !== "paused") return { accepted: false, state: "running", error: "selftest child is not paused" };
      selftestState = "running";
      scheduleSelftest();
      return { accepted: true, state: "running" };
    }
    return {
      accepted: false,
      state: selftestState,
      error: note?.trim() ? "selftest has no model to steer" : "steer note is empty",
    };
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    for (const line of lines.push(chunk)) {
      if (!line.trim()) continue;
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; }
      catch { process.stderr.write("invalid parent frame\n"); process.exitCode = 64; return; }
      if (message["type"] === "task" && !started) {
        started = true;
        if (mode === "selftest") {
          emit({ type: "stage", name: "installed-package-selftest", face: "" });
          selftestState = "running";
          scheduleSelftest();
          // The task and an immediate control can arrive in the same pipe
          // chunk. Continue draining the already-framed lines; returning here
          // silently dropped that control and made the parent time out its
          // acknowledgement.
          continue;
        }
        const allowed = Array.isArray(message["allowed_tools"])
          ? message["allowed_tools"].filter((tool): tool is ToolName => (TOOLS as readonly unknown[]).includes(tool))
          : [];
        brain = new OllamaBrain({ tools: allowed });
        const task = message as unknown as TaskCommand;
        void (async () => {
          for await (const event of brain!.run(task)) emit(event);
        })().catch((error) => {
          emit({ type: "error", msg: error instanceof Error ? error.message : String(error) });
          process.exitCode = 1;
        });
      } else if (message["type"] === "tool_result" && brain) {
        brain.sendToolResult(String(message["id"] ?? ""), {
          output: String(message["output"] ?? ""), exitCode: Number(message["exitCode"] ?? 1),
        });
      } else if (message["type"] === "control") {
        const id = String(message["id"] ?? "");
        const action = message["action"];
        if (!id || (action !== "pause" && action !== "resume" && action !== "steer")) {
          process.stdout.write(JSON.stringify({
            type: "control_result", id, accepted: false, state: "closed", error: "invalid control message",
          }) + "\n");
          continue;
        }
        const note = typeof message["note"] === "string" ? message["note"] : undefined;
        const result = mode === "selftest"
          ? selftestControl(action, note)
          : brain?.control(action, note) ?? { accepted: false, state: "closed" as const, error: "brain is not running" };
        void Promise.resolve(result).then((ack) => {
          process.stdout.write(JSON.stringify({ type: "control_result", id, ...ack }) + "\n");
        });
      }
    }
  });
  process.stdin.on("end", () => {
    if (lines.rest().trim()) process.exitCode = 64;
    if (selftestTimer) clearTimeout(selftestTimer);
    if (selftestState === "running") finishSelftest();
  });
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === resolve(fileURLToPath(import.meta.url))) {
  const mode = process.argv[2] === "selftest" ? "selftest" : "ollama";
  runHeadlessBrainChild(mode);
}
