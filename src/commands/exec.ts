import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "../core/context.js";
import { BundledChildBrain, type BundledChildMode } from "../core/brain_bundled_child.js";
import type { Brain, TaskCommand } from "../core/brain.js";
import type { BrainDone, VerifyOutcome } from "../core/verify_gate.js";
import { ToolExecutor, type ToolResult } from "../core/tool_executor.js";
import { TOOLS, PROTOCOL_VERSION } from "../core/brain_protocol.js";
import { toolDefinition } from "../core/tool_registry.js";
import { ControlLedger, HeadlessWriter, HEADLESS_CONTROL_PROTOCOL, HEADLESS_MAX_LINE_BYTES, parseControlFrame, redactHeadless } from "../core/headless_protocol.js";
import { LineBuffer } from "../core/brain_protocol.js";
import { resolveLocalModelSelection } from "../core/local_ollama.js";

export const EXEC_EXIT = { ok: 0, failed: 1, usage: 2, unverified: 4, protocol: 64, timeout: 124, cancelled: 130 } as const;
export type ExecPermission = "deny" | "read-only" | "workspace-write";
export const EXEC_V1_TOOLS = ["read_file", "write_file", "repo_search"] as const;
export interface ExecOptions {
  permission: ExecPermission;
  allowedTools: readonly string[];
  capabilityPacks: readonly string[];
  timeoutMs: number;
  verifyCommand?: string;
  brain?: Brain;
  writeLine?: (line: string) => void;
  sessionId?: string;
  resume?: string;
  driver?: BundledChildMode;
}

function git(cwd: string, args: string[]): string | null {
  const run = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", shell: false, timeout: 3000 });
  return run.status === 0 ? String(run.stdout).trim() || null : null;
}

function repositoryIdentity(cwd: string): Record<string, unknown> {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  return {
    root: root ? realpathSync(root) : realpathSync(cwd),
    git: Boolean(root),
    head: root ? git(root, ["rev-parse", "HEAD"]) : null,
    branch: root ? git(root, ["branch", "--show-current"]) : null,
    remote: root ? git(root, ["remote", "get-url", "origin"]) : null,
  };
}

function allowed(permission: ExecPermission, tool: string, declared: ReadonlySet<string>): { ok: boolean; reason: string } {
  const definition = toolDefinition(tool);
  if (!definition) return { ok: false, reason: "unknown-tool" };
  if (["network", "shell", "git"].includes(definition.sideEffect)) return { ok: false, reason: `${definition.sideEffect}-disabled` };
  if (!declared.has(tool)) return { ok: false, reason: "undeclared-tool" };
  if (permission === "deny") return { ok: false, reason: "permission-deny" };
  if (permission === "read-only" && definition.sideEffect !== "read") return { ok: false, reason: "permission-escalation" };
  return { ok: true, reason: "declared-and-authorized" };
}

function verificationStatus(result: ToolResult | null, configured: boolean): VerifyOutcome {
  if (!configured) return { status: "unverified", remaining: 0, exitCode: -1 };
  if (result?.exitCode === 0) return { status: "ok", remaining: 0, exitCode: 0 };
  return { status: "incomplete", remaining: 0, exitCode: result?.exitCode || 1 };
}

export async function runHeadlessExec(ctx: AppContext, task: string, opts: ExecOptions): Promise<number> {
  const cwd = realpathSync(resolve(ctx.flags.cwd));
  const driver = opts.driver ?? "ollama";
  if (driver === "selftest" && ctx.flags.model?.trim()) {
    process.stderr.write("aether exec: --model is unavailable with the selftest driver; selftest performs no model work\n");
    return EXEC_EXIT.usage;
  }
  let localModel: { tag: string; id: string } | null = null;
  if (driver === "ollama") {
    try {
      localModel = resolveLocalModelSelection(ctx.flags.model, ctx.cfg.localModel ?? "");
    } catch (error) {
      const explicit = ctx.flags.model?.trim();
      const message = explicit && !explicit.startsWith("ollama:")
        ? `Model ${JSON.stringify(explicit)} is unavailable to aether exec. Use an explicit ollama:<tag>; bare and hosted model ids are rejected.`
        : error instanceof Error ? error.message : String(error);
      process.stderr.write(`aether exec: ${String(redactHeadless(message))}\n`);
      return EXEC_EXIT.usage;
    }
  }
  const writer = new HeadlessWriter(cwd, opts.writeLine, opts.sessionId);
  const declared = new Set(opts.allowedTools.filter((tool) => (EXEC_V1_TOOLS as readonly string[]).includes(tool)));
  const warnings: string[] = [];
  if (process.stdin.isTTY) warnings.push("stdin controls unavailable on a TTY; send process signals or pipe versioned JSONL controls");
  if (!opts.verifyCommand) warnings.push("no verification command configured; successful agent completion remains non-zero/unverified");
  if (opts.resume) warnings.push("resume is not supported by aether.exec/1; the request will be rejected without starting a brain");
  if (driver === "selftest") warnings.push("selftest driver validates installed child/protocol wiring only; it performs no model work");
  const brain = opts.brain ?? new BundledChildBrain({
    mode: driver,
    allowedTools: [...declared] as (typeof EXEC_V1_TOOLS)[number][],
    diagnostic: (text) => process.stderr.write(String(redactHeadless(text))),
  });
  const exec = new ToolExecutor(cwd, opts.verifyCommand);
  const abort = new AbortController();
  let cancelled = false;
  let timedOut = false;
  let protocolFailed = false;
  let done: BrainDone | null = null;
  let brainFailed = false;
  const controlLedger = new ControlLedger();
  const controls = new LineBuffer();

  writer.emit("session", {
    session: writer.sessionId,
    bridge_protocol: PROTOCOL_VERSION,
    repository: repositoryIdentity(cwd),
    backend: driver === "selftest" ? "bundled-selftest-child" : "bundled-ollama-child",
    model: localModel?.id ?? null,
    effort: (ctx.flags.effort ?? ctx.cfg.defaultEffort) || null,
    permissions: {
      mode: opts.permission, explicit_decisions: true,
      agent_network_tools: "disabled", agent_shell_tools: "disabled", remote_shell: "disabled",
    },
    tools: [...declared].sort(),
    capability_packs: [...opts.capabilityPacks].sort(),
    warnings,
    verification_command: opts.verifyCommand ?? null,
    control_protocol: HEADLESS_CONTROL_PROTOCOL,
  });

  if (opts.resume) {
    writer.emit("control_result", {
      action: "resume", accepted: false, error: "unsupported in aether.exec/1", requested_session: opts.resume,
    });
    writer.terminal({ ok: false, exit_code: EXEC_EXIT.usage, reason: "resume-unsupported" });
    return EXEC_EXIT.usage;
  }

  const cancel = (reason: "signal" | "control" | "timeout" | "protocol"): void => {
    if (!cancelled) {
      cancelled = true;
      timedOut = reason === "timeout";
      protocolFailed = reason === "protocol";
      abort.abort();
      brain.close();
      writer.emit("cancelled", { reason });
    }
  };
  const onSignal = (): void => cancel("signal");
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const timer = setTimeout(() => cancel("timeout"), opts.timeoutMs);
  timer.unref();

  const consumeControl = (line: string): void => {
    const parsed = parseControlFrame(line);
    if (!parsed.ok) {
      writer.emit("control_result", { accepted: false, error: parsed.error });
      cancel("protocol");
      return;
    }
    const frame = parsed.frame;
    const ledger = controlLedger.accept(frame);
    if (!ledger.accepted) {
      writer.emit("control_result", { accepted: false, action: frame.action, error: ledger.error }, frame.correlation_id);
      cancel("protocol");
      return;
    }
    if (frame.action === "cancel") {
      writer.emit("control_result", { accepted: true, action: frame.action }, frame.correlation_id);
      cancel("control");
      return;
    }
    writer.emit("control_result", {
      accepted: false, action: frame.action, error: "unsupported in aether.exec/1; instruction was not applied",
    }, frame.correlation_id);
  };
  const onStdin = (chunk: Buffer | string): void => {
    for (const line of controls.push(String(chunk))) {
      if (cancelled) break;
      if (line.trim()) consumeControl(line);
    }
    if (!cancelled && Buffer.byteLength(controls.rest(), "utf8") > HEADLESS_MAX_LINE_BYTES) {
      writer.emit("control_result", { accepted: false, error: "unterminated control frame exceeds 16384 bytes" });
      cancel("protocol");
    }
  };
  const onStdinEnd = (): void => {
    if (!cancelled && controls.rest().trim()) {
      writer.emit("control_result", { accepted: false, error: "truncated control frame" });
      cancel("protocol");
    }
  };
  if (!process.stdin.isTTY) {
    process.stdin.on("data", onStdin);
    process.stdin.once("end", onStdinEnd);
  }

  try {
    const taskCommand: TaskCommand = {
      type: "task", text: task, cwd, poolGb: 5,
      model: localModel?.tag, effort: (ctx.flags.effort ?? ctx.cfg.defaultEffort) || undefined, testCmd: opts.verifyCommand,
    };
    for await (const event of brain.run(taskCommand)) {
      if (cancelled) break;
      const correlation = event.type === "tool_call" && event.id ? event.id : writer.sessionId;
      writer.emit("agent_event", { event }, correlation);
      if (event.type === "tool_call") {
        const decision = allowed(opts.permission, event.name, declared);
        writer.emit("permission_decision", { tool: event.name, approved: decision.ok, reason: decision.reason }, event.id);
        const result = decision.ok
          ? await exec.executeAsync(event.name, event.args, { signal: abort.signal, timeoutMs: opts.timeoutMs })
          : { output: `[denied: ${decision.reason}]`, exitCode: 1 };
        writer.emit("tool_receipt", { tool: event.name, exit_code: result.exitCode, output: result.output }, event.id);
        brain.sendToolResult(event.id, result);
      } else if (event.type === "done") {
        done = { ok: event.ok, remaining: event.remaining, reason: event.reason };
      } else if (event.type === "error") {
        brainFailed = true;
      }
    }
  } catch (error) {
    brainFailed = true;
    process.stderr.write(`aether exec: ${String(redactHeadless(error instanceof Error ? error.message : String(error)))}\n`);
    writer.emit("diagnostic", { level: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    brain.close();
  }

  let verification: VerifyOutcome;
  let verificationOutput = "[cancelled before verification]";
  if (cancelled) verification = { status: "error", remaining: 0, exitCode: timedOut ? 124 : 130 };
  else {
    const result = opts.verifyCommand
      ? await exec.executeAsync("run_tests", { command: opts.verifyCommand }, { signal: abort.signal, timeoutMs: opts.timeoutMs })
      : null;
    verification = verificationStatus(result, Boolean(opts.verifyCommand));
    verificationOutput = result?.output ?? "[not configured]";
  }
  writer.emit("verification", {
    status: verification.status, exit_code: verification.exitCode,
    authoritative: true, output: verificationOutput,
  });
  const exitCode = protocolFailed ? EXEC_EXIT.protocol
    : timedOut ? EXEC_EXIT.timeout
      : cancelled ? EXEC_EXIT.cancelled
        : brainFailed || !done?.ok ? EXEC_EXIT.failed
          : verification.status === "ok" ? EXEC_EXIT.ok
            : verification.status === "unverified" ? EXEC_EXIT.unverified : EXEC_EXIT.failed;
  writer.terminal({ ok: exitCode === 0, exit_code: exitCode, verification, agent: done });
  clearTimeout(timer);
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
  process.stdin.removeListener("data", onStdin);
  process.stdin.removeListener("end", onStdinEnd);
  return exitCode;
}

export async function cmdExec(ctx: AppContext, argv: string[], flags: {
  str(name: string): string | undefined; list(name: string): string[];
}): Promise<number> {
  const task = argv.join(" ").trim();
  if (!task) {
    process.stderr.write('usage: aether exec [flags] "task"\n');
    return EXEC_EXIT.usage;
  }
  if (Buffer.byteLength(task, "utf8") > 64 * 1024) {
    process.stderr.write("aether exec: task exceeds 65536 bytes\n");
    return EXEC_EXIT.usage;
  }
  const permission = flags.str("permission") ?? "read-only";
  if (!["deny", "read-only", "workspace-write"].includes(permission)) {
    process.stderr.write("aether exec: --permission must be deny, read-only, or workspace-write\n");
    return EXEC_EXIT.usage;
  }
  const timeout = Number(flags.str("timeout-ms") ?? "900000");
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 3_600_000) {
    process.stderr.write("aether exec: --timeout-ms must be an integer from 100 to 3600000\n");
    return EXEC_EXIT.usage;
  }
  const requested = flags.list("allow-tool");
  const unknown = requested.filter((tool) => !(TOOLS as readonly string[]).includes(tool));
  if (unknown.length) {
    process.stderr.write(`aether exec: unknown --allow-tool ${unknown[0]}\n`);
    return EXEC_EXIT.usage;
  }
  const forbidden = requested.filter((tool) => !(EXEC_V1_TOOLS as readonly string[]).includes(tool));
  if (forbidden.length) {
    process.stderr.write(`aether exec: --allow-tool ${forbidden[0]} is unavailable in v1 (shell, git, and network tools are disabled)\n`);
    return EXEC_EXIT.usage;
  }
  const packs = flags.list("capability-pack");
  if (packs.length > 16 || packs.some((pack) => !/^[a-z][a-z0-9._-]{0,127}$/.test(pack))) {
    process.stderr.write("aether exec: capability packs must be 1-16 bounded identifiers\n");
    return EXEC_EXIT.usage;
  }
  const driver = flags.str("exec-driver") ?? "ollama";
  if (driver !== "ollama" && driver !== "selftest") {
    process.stderr.write("aether exec: --exec-driver must be ollama or selftest\n");
    return EXEC_EXIT.usage;
  }
  return runHeadlessExec(ctx, task, {
    permission: permission as ExecPermission,
    allowedTools: requested.length ? requested : ["read_file", "repo_search"],
    capabilityPacks: packs.length ? packs : ["core.read.v1"],
    timeoutMs: timeout,
    verifyCommand: ctx.flags.testCmd,
    resume: ctx.flags.resume,
    driver,
  });
}
