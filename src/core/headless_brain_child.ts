import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OllamaBrain } from "./brain_ollama.js";
import { LineBuffer, TOOLS, type BrainEvent, type ToolName } from "./brain_protocol.js";
import type { TaskCommand } from "./brain.js";

type ChildMode = "ollama" | "selftest";

function emit(event: BrainEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

export function runHeadlessBrainChild(mode: ChildMode): void {
  const lines = new LineBuffer();
  let brain: OllamaBrain | null = null;
  let started = false;
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
          emit({ type: "done", ok: true, result: "bundled child protocol selftest complete", remaining: 0, reason: "" });
          process.stdin.pause();
          return;
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
      }
    }
  });
  process.stdin.on("end", () => {
    if (lines.rest().trim()) process.exitCode = 64;
  });
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === resolve(fileURLToPath(import.meta.url))) {
  const mode = process.argv[2] === "selftest" ? "selftest" : "ollama";
  runHeadlessBrainChild(mode);
}
