import { spawnSync } from "node:child_process";

export interface KillableChild {
  pid?: number;
  killed?: boolean;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface ProcessTreeOps {
  platform?: NodeJS.Platform;
  taskkill?: (pid: number) => void;
  signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
  escalateMs?: number;
}

/** Terminate a whole spawned process tree, not only its immediate shell/brain. */
export function terminateProcessTree(child: KillableChild | null, ops: ProcessTreeOps = {}): void {
  if (!child || child.killed || child.pid === undefined) return;
  const pid = child.pid;
  const platform = ops.platform ?? process.platform;
  if (platform === "win32") {
    (ops.taskkill ?? ((target) => {
      spawnSync("taskkill", ["/pid", String(target), "/T", "/F"], { encoding: "utf8", windowsHide: true });
    }))(pid);
    return;
  }
  const signal = ops.signalGroup ?? ((target, sig) => process.kill(-target, sig));
  try { signal(pid, "SIGTERM"); } catch { return; }
  const timer = setTimeout(() => {
    try { signal(pid, "SIGKILL"); } catch { /* already reaped */ }
  }, ops.escalateMs ?? 2000);
  timer.unref();
}
