// rc.ts — `aether rc` / `/rc`: Remote Control for the current local session
// (AETHER-AGENT-LIVE-01 R2, frozen contract: AETHER-CLOUD ADR-0007).
//
//   aether rc [name]     start (or resume) remote control, optionally named
//   aether rc status     show the RC indicator, viewer URL, QR, expiry
//   aether rc off        revoke ALL remote access; the local session keeps running
//
// Every failure path in this command is fail-soft by construction: remote
// control breaking — broker down, signed out, revoked — never stops, corrupts,
// or downgrades the local Agent session. The command only ever prints.

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Writable } from "node:stream";
import type { AppContext } from "../core/context.js";
import { configDir } from "../core/config.js";
import { theme } from "../ui/theme.js";
import { renderQr } from "../ui/qr.js";
import { readRepoIdentity } from "../core/session_log.js";
import { defaultRunner } from "../core/worktree.js";
import {
  getRemoteHost,
  RemoteHostClient,
  setRemoteHost,
  type RcStartInput,
  type RcStatus,
  type RcTransport,
} from "../core/remote_host.js";

export const RC_EXIT = { ok: 0, failed: 1, usage: 2 } as const;

export interface RcOptions {
  out?: Writable;
  err?: Writable;
  /** CLI mode: keep the process (and the host connection) open until Ctrl+C.
   *  The REPL passes false — its host lives for the session. */
  wait?: boolean;
  /** Test seam: a preconstructed host client. Production builds its own. */
  host?: RemoteHostClient;
}

/** Durable cursor/outbox path — per project, beside the token (0700 dir). */
export function rcStatePath(projectRoot: string): string {
  const key = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
  return join(configDir(), "rc", `host-${key}.json`);
}

const INDICATOR: Record<RcStatus["phase"], string> = {
  active: "● active",
  reconnecting: "◌ reconnecting",
  failed: "✖ failed",
  off: "○ off",
};

function renderStatus(status: RcStatus, out: Writable): void {
  const name = status.sessionName ? ` — ${JSON.stringify(status.sessionName)}` : "";
  out.write(`Remote Control: ${theme.bold(INDICATOR[status.phase])}${name}\n`);
  if (status.sessionId) out.write(`  session   ${status.sessionId}\n`);
  if (status.viewerUrl) out.write(`  viewer    ${theme.cyan(status.viewerUrl)}\n`);
  if (status.expiresAt) out.write(`  expires   ${status.expiresAt}\n`);
  if (status.phase !== "off") {
    out.write(`  events    ${status.pendingEvents} pending, ${status.lastAckedSeq} acked` +
      (status.droppedEvents ? `, ${status.droppedEvents} dropped` : "") + "\n");
  }
  if (status.detail) out.write(`  ${theme.dim(status.detail)}\n`);
  if (status.phase === "active") {
    const qrTarget = status.redemptionUrl ?? status.viewerUrl;
    if (qrTarget) {
      const qr = renderQr(qrTarget);
      if (qr) out.write("\n" + qr + "\n\n");
      out.write(theme.dim("  Scan (or open the viewer URL) on your phone. The QR carries a single-use\n"));
      out.write(theme.dim("  redemption id — never a reusable token. Revoke anytime: /rc off\n"));
    }
  }
}

/** Strip credentials from a git remote before it is sent as an identifier. */
function safeRemote(remote: string): string {
  return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1");
}

function buildStartInput(ctx: AppContext, sessionName: string | undefined): RcStartInput {
  let repo: RcStartInput["repo"];
  try {
    const identity = readRepoIdentity(ctx.flags.cwd, defaultRunner());
    if (identity) {
      repo = {
        ...(identity.remote ? { repo: safeRemote(identity.remote) } : {}),
        ...(identity.branch ? { branch: identity.branch } : {}),
        ...(identity.head ? { base_commit: identity.head } : {}),
      };
    }
  } catch {
    // No git, no identity — RC still works, the viewer just shows less.
  }
  return { ...(sessionName ? { sessionName } : {}), ...(repo ? { repo } : {}) };
}

function buildHost(ctx: AppContext): RemoteHostClient {
  // The existing ApiClient owns the base URL (config baseUrl / AETHER_BASE_URL
  // override), bearer handling, refresh-on-401, and the refusal to put
  // credentials on an insecure transport. RC rides all of that unchanged.
  const transport: RcTransport = {
    postJson: (path, body) => ctx.api.postJson(path, body),
  };
  return new RemoteHostClient({
    transport,
    statePath: rcStatePath(ctx.flags.cwd),
    projectRoot: ctx.flags.cwd,
  });
}

async function waitForInterrupt(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = (): void => {
      process.removeListener("SIGINT", done);
      process.removeListener("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

export async function cmdRc(ctx: AppContext, argv: string[], options: RcOptions = {}): Promise<number> {
  const out = options.out ?? process.stdout;
  const err = options.err ?? process.stderr;
  const sub = (argv[0] ?? "").toLowerCase();

  if (sub === "status") {
    if (argv.length !== 1) {
      err.write("usage: aether rc [status|off|<session name>]\n");
      return RC_EXIT.usage;
    }
    const host = getRemoteHost();
    renderStatus(host ? host.status() : { phase: "off", pendingEvents: 0, lastAckedSeq: 0, droppedEvents: 0 }, out);
    return RC_EXIT.ok;
  }

  if (sub === "off") {
    if (argv.length !== 1) {
      err.write("usage: aether rc [status|off|<session name>]\n");
      return RC_EXIT.usage;
    }
    const host = getRemoteHost() ?? options.host ?? buildHost(ctx);
    const status = await host.off();
    setRemoteHost(null);
    renderStatus(status, out);
    out.write("Remote access is revoked. The local session is unaffected.\n");
    return RC_EXIT.ok;
  }

  // start — everything else is an optional session name.
  const sessionName = argv.join(" ").trim() || undefined;
  const token = await ctx.tokens.get();
  if (!token) {
    err.write(
      "Remote Control needs a signed-in session — run `aether auth login` first.\n" +
        "The local session keeps working without it.\n",
    );
    return RC_EXIT.failed;
  }

  const existing = getRemoteHost();
  if (existing && existing.status().phase === "active") {
    out.write("Remote Control is already active for this session.\n");
    renderStatus(existing.status(), out);
    return RC_EXIT.ok;
  }

  const host = options.host ?? buildHost(ctx);
  const status = await host.start(buildStartInput(ctx, sessionName));
  if (status.phase === "active") {
    setRemoteHost(host);
    host.publish("session", {
      state: "live",
      ...(sessionName ? { session_name: sessionName } : {}),
      execution: "local",
      protocol_version: 1,
    });
    host.publish("presence", { role: "host", state: "connected" });
    renderStatus(host.status(), out);
    if (options.wait) {
      out.write(theme.dim("Remote Control stays connected while this process runs — Ctrl+C to\n"));
      out.write(theme.dim("disconnect (grants stay valid until they expire; `aether rc off` revokes).\n"));
      await waitForInterrupt();
      host.stopLocal();
      setRemoteHost(null);
      out.write("Remote Control disconnected. Run `aether rc off` to revoke access.\n");
    }
    return RC_EXIT.ok;
  }

  renderStatus(status, err);
  err.write("Remote Control did not start. The local session is unaffected.\n");
  return RC_EXIT.failed;
}
