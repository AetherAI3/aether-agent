// `aether device` — the operator command group for the dev-only, default-off
// Windows device runtime (SC-DEVICE-01). Every subcommand is local operator
// control: enroll, start/stop/restart the detached daemon, inspect status /
// health / managed groups / last command, run structured diagnostics, and
// install or remove the boot-persistence scheduled task. The daemon itself is
// the only thing that talks to the Cloud on a cadence; these are one-shot.

import { spawn, spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import type { AppContext } from "../core/context.js";
import type { CommandFlags } from "../core/command_dispatch.js";
import { renderHealthReport } from "../core/health.js";
import { DEVICE_ENROLL_PATH } from "../core/device_runtime/contract.js";
import { deviceRuntimeEnabled } from "../core/device_runtime/enablement.js";
import { loadEnrollment, saveEnrollment, type EnrollmentRecord } from "../core/device_runtime/identity.js";
import { DeviceNet } from "../core/device_runtime/net.js";
import { spawnPowerShellWarden } from "../core/device_runtime/containment.js";
import { listGroups } from "../core/device_runtime/registry.js";
import { loadChain } from "../core/device_runtime/commands_exec.js";
import { daemonPidAlive, readDaemonState } from "../core/device_runtime/daemon_state.js";
import { buildDeviceDoctorReport, type DoctorProbes } from "../core/device_runtime/doctor.js";

export const DEVICE_EXIT = {
  ok: 0,
  usage: 2,
  disabled: 3,
  notEnrolled: 4,
  notRunning: 5,
  failed: 6,
  declined: 20,
} as const;

const SCHEDULED_TASK_NAME = "AetherDeviceRuntime";

interface EnrollResponse {
  device_id?: string;
  device_token?: string;
  device_command_key?: string;
  display_name?: string;
}

function daemonScriptPath(): string {
  return fileURLToPath(new URL("../core/device_runtime/daemon.js", import.meta.url));
}

function out(ctx: AppContext, human: string, json: unknown): number {
  if (ctx.flags.json) process.stdout.write(JSON.stringify(json) + "\n");
  else process.stdout.write(human);
  return DEVICE_EXIT.ok;
}

/** How stale (ms) the daemon heartbeat may be before status calls it stalled. */
const STALE_MS = 30_000;

export async function cmdDevice(ctx: AppContext, argv: string[], flags: CommandFlags): Promise<number> {
  const sub = argv[0] ?? "status";
  switch (sub) {
    case "status":
    case undefined:
      return statusPanel(ctx);
    case "enroll":
      return enroll(ctx);
    case "start":
      return start(ctx);
    case "stop":
      return stop(ctx);
    case "restart": {
      await stop(ctx);
      return start(ctx);
    }
    case "doctor":
      return doctor(ctx);
    case "health":
      return health(ctx);
    case "groups":
      return groups(ctx);
    case "last":
      return last(ctx);
    case "install-service":
      return installService(ctx, flags);
    case "uninstall-service":
      return uninstallService(ctx);
    default:
      process.stderr.write(
        "usage: aether device <status|enroll|start|stop|restart|doctor|health|groups|last|install-service|uninstall-service>\n",
      );
      return DEVICE_EXIT.usage;
  }
}

function statusPanel(ctx: AppContext): number {
  const enrolled = loadEnrollment();
  const state = readDaemonState();
  const running = state ? daemonPidAlive(state.pid) : false;
  const ageMs = state ? Date.now() - state.updated_at : null;
  const stale = ageMs !== null && ageMs > STALE_MS;
  const enabled = deviceRuntimeEnabled(ctx.cfg);
  const summary = {
    enrolled: Boolean(enrolled),
    device_id: enrolled?.device_id ?? null,
    enabled,
    running,
    stale,
    last_publish_seq: state?.last_publish_seq ?? 0,
    queue_depth: state?.queue_depth ?? 0,
    online: state?.online ?? false,
    heartbeat_age_s: ageMs === null ? null : Math.round(ageMs / 1000),
  };
  const lines = [
    `Aether device runtime`,
    `  enrolled:   ${summary.enrolled ? summary.device_id : "no"}`,
    `  enabled:    ${enabled ? "yes" : "no (default-off)"}`,
    `  daemon:     ${running ? (stale ? "running (heartbeat stale)" : "running") : "not running"}`,
    `  last seq:   ${summary.last_publish_seq}${summary.online ? "" : " (offline)"}`,
    `  queue:      ${summary.queue_depth}`,
    summary.heartbeat_age_s === null ? "  heartbeat:  never" : `  heartbeat:  ${summary.heartbeat_age_s}s ago`,
    "",
  ].join("\n");
  return out(ctx, lines, summary);
}

async function enroll(ctx: AppContext): Promise<number> {
  const token = await ctx.tokens.get();
  if (!token) {
    process.stderr.write("enroll needs an authenticated session — run `aether auth login` first.\n");
    return DEVICE_EXIT.notEnrolled;
  }
  let resp: EnrollResponse;
  try {
    resp = await ctx.api.postJson<EnrollResponse>(DEVICE_ENROLL_PATH, {
      display_name: hostname(),
      client: "aether-cli",
    });
  } catch (err) {
    process.stderr.write(`enrollment failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return DEVICE_EXIT.failed;
  }
  if (!resp.device_id || !resp.device_token || !resp.device_command_key) {
    process.stderr.write("enrollment response was missing the device id, token, or command key.\n");
    return DEVICE_EXIT.failed;
  }
  const record: EnrollmentRecord = {
    device_id: resp.device_id,
    device_token: resp.device_token,
    device_command_key: resp.device_command_key,
    display_name: resp.display_name ?? hostname(),
    base_url: ctx.cfg.baseUrl,
    enrolled_at: Date.now(),
  };
  saveEnrollment(record);
  return out(ctx, `Enrolled device ${record.device_id}.\n`, { enrolled: true, device_id: record.device_id });
}

async function start(ctx: AppContext): Promise<number> {
  if (!deviceRuntimeEnabled(ctx.cfg)) {
    process.stderr.write(
      "device runtime is disabled (default-off). Enable it with `aether config set deviceRuntime.enabled true` " +
        "or AETHER_DEVICE_RUNTIME=1 before starting.\n",
    );
    return DEVICE_EXIT.disabled;
  }
  if (!loadEnrollment()) {
    process.stderr.write("device is not enrolled — run `aether device enroll` first.\n");
    return DEVICE_EXIT.notEnrolled;
  }
  const state = readDaemonState();
  if (state && daemonPidAlive(state.pid)) {
    return out(ctx, `Daemon already running (pid ${state.pid}).\n`, { started: false, pid: state.pid });
  }
  try {
    const child = spawn(process.execPath, [daemonScriptPath()], {
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, AETHER_DEVICE_RUNTIME: "1" },
    });
    child.unref();
    return out(ctx, "Device daemon started.\n", { started: true });
  } catch (err) {
    process.stderr.write(`failed to start the daemon: ${err instanceof Error ? err.message : String(err)}\n`);
    return DEVICE_EXIT.failed;
  }
}

async function stop(ctx: AppContext): Promise<number> {
  const state = readDaemonState();
  if (!state || !daemonPidAlive(state.pid)) {
    return out(ctx, "Daemon is not running.\n", { stopped: false });
  }
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(state.pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(state.pid, "SIGTERM");
    }
  } catch (err) {
    process.stderr.write(`failed to stop the daemon: ${err instanceof Error ? err.message : String(err)}\n`);
    return DEVICE_EXIT.failed;
  }
  return out(ctx, `Stopped daemon (pid ${state.pid}).\n`, { stopped: true, pid: state.pid });
}

async function doctor(ctx: AppContext): Promise<number> {
  const enrolled = loadEnrollment();
  const probes: DoctorProbes = {
    cloud: async () => {
      if (!enrolled) return { reachable: false, status: null, latencyMs: 0 };
      try {
        const net = new DeviceNet(enrolled.base_url, enrolled.device_token);
        return await net.health();
      } catch {
        return { reachable: false, status: null, latencyMs: 0 };
      }
    },
    jobObject: async () => {
      if (process.platform !== "win32") return false;
      try {
        const warden = await spawnPowerShellWarden();
        await warden.close();
        return true;
      } catch {
        return false;
      }
    },
    scheduledTask: () => scheduledTaskPresent(),
    now: Date.now,
  };
  const report = await buildDeviceDoctorReport(ctx.cfg, probes);
  if (ctx.flags.json) {
    process.stdout.write(JSON.stringify(report) + "\n");
  } else {
    process.stdout.write(renderHealthReport(report));
  }
  return report.summary.error > 0 ? DEVICE_EXIT.failed : DEVICE_EXIT.ok;
}

async function health(ctx: AppContext): Promise<number> {
  // A live one-shot sample, without publishing anything. Imported lazily so the
  // status path stays cheap.
  const { TelemetrySampler, defaultTelemetryInputs, composeObservation, serializeObservation } = await import(
    "../core/device_runtime/telemetry.js"
  );
  const enrolled = loadEnrollment();
  const sampler = new TelemetrySampler(defaultTelemetryInputs(ctx.flags.cwd));
  // Two samples so CPU utilisation has a delta to report.
  sampler.sample();
  await new Promise((r) => setTimeout(r, 200));
  const metrics = sampler.sample();
  const observation = serializeObservation(
    composeObservation(
      {
        device_id: enrolled?.device_id ?? "unenrolled",
        boot_id: "local",
        seq: 0,
        agent_version: "",
        display_name: enrolled?.display_name ?? hostname(),
        capabilities: [],
        runtime_labels: [process.platform],
        repo: null,
        lanes_active: 0,
        lanes_reserved: 0,
        workload_count: listGroups().length,
      },
      metrics,
    ),
  );
  const lines =
    `cpu ${observation.cpu_util_pct}%  mem ${observation.mem_used_pct}%  ` +
    `disk_free ${observation.disk_workspace_free_gb}GB  workloads ${observation.workload_count}\n`;
  return out(ctx, lines, observation);
}

function groups(ctx: AppContext): number {
  const now = Date.now();
  const items = listGroups({ now: () => now }).map((g) => ({
    process_group_id: g.process_group_id,
    exe_path: g.exe_path,
    expires_at: g.expires_at,
    expires_in_s: Math.max(0, Math.round((g.expires_at - now) / 1000)),
  }));
  const human = items.length
    ? items.map((g) => `${g.process_group_id}  ${g.exe_path}  (expires in ${g.expires_in_s}s)`).join("\n") + "\n"
    : "No managed process groups.\n";
  return out(ctx, human, { groups: items });
}

function last(ctx: AppContext): number {
  const enrolled = loadEnrollment();
  if (!enrolled) {
    return out(ctx, "Device is not enrolled.\n", { enrolled: false });
  }
  const chain = loadChain(enrolled.device_id);
  const lastId = chain.seen_command_ids[chain.seen_command_ids.length - 1] ?? null;
  const lastResult = lastId ? chain.results[lastId] ?? null : null;
  // Never surface secrets: the result's detail is already redacted, and only the
  // command id, status, and result_seq are shown.
  const summary = {
    last_command_id: lastId,
    last_outbox_seq: chain.last_outbox_seq,
    last_status: lastResult?.status ?? null,
    last_detail: lastResult?.detail ?? null,
    result_seq: chain.result_seq,
  };
  const human = lastId
    ? `last command ${lastId}\n  status: ${summary.last_status}\n  detail: ${summary.last_detail}\n  outbox_seq: ${summary.last_outbox_seq}\n`
    : "No commands processed yet.\n";
  return out(ctx, human, summary);
}

function scheduledTaskPresent(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const res = spawnSync("schtasks", ["/query", "/tn", SCHEDULED_TASK_NAME], { windowsHide: true, encoding: "utf8" });
    return res.status === 0;
  } catch {
    return false;
  }
}

async function installService(ctx: AppContext, _flags: CommandFlags): Promise<number> {
  if (process.platform !== "win32") {
    process.stderr.write("install-service is Windows-only (uses schtasks).\n");
    return DEVICE_EXIT.failed;
  }
  const command = `"${process.execPath}" "${daemonScriptPath()}"`;
  process.stderr.write(
    "This installs a per-logon scheduled task that starts the device daemon:\n" +
      `  name: ${SCHEDULED_TASK_NAME}\n  trigger: onlogon\n  runs: ${command}\n` +
      "The daemon still refuses to run unless the runtime is enabled.\n",
  );
  if (!ctx.flags.yes && !(await ctx.confirm("Install the boot-persistence task? [y/N] "))) {
    process.stderr.write("Not installed. Pass --yes in a non-interactive session.\n");
    return DEVICE_EXIT.declined;
  }
  const res = spawnSync(
    "schtasks",
    ["/create", "/tn", SCHEDULED_TASK_NAME, "/sc", "onlogon", "/tr", command, "/f"],
    { windowsHide: true, encoding: "utf8" },
  );
  if (res.status !== 0) {
    process.stderr.write(`schtasks failed (exit ${res.status ?? "?"}).\n`);
    return DEVICE_EXIT.failed;
  }
  return out(ctx, `Installed scheduled task ${SCHEDULED_TASK_NAME}.\n`, { installed: true });
}

async function uninstallService(ctx: AppContext): Promise<number> {
  if (process.platform !== "win32") {
    process.stderr.write("uninstall-service is Windows-only (uses schtasks).\n");
    return DEVICE_EXIT.failed;
  }
  if (!scheduledTaskPresent()) {
    return out(ctx, "No scheduled task to remove.\n", { removed: false });
  }
  const res = spawnSync("schtasks", ["/delete", "/tn", SCHEDULED_TASK_NAME, "/f"], { windowsHide: true, encoding: "utf8" });
  if (res.status !== 0) {
    process.stderr.write(`schtasks failed (exit ${res.status ?? "?"}).\n`);
    return DEVICE_EXIT.failed;
  }
  return out(ctx, `Removed scheduled task ${SCHEDULED_TASK_NAME}.\n`, { removed: true });
}
