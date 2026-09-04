// `aether voice` operator surface. The portable Voice controller is available
// to embedders through index.ts, but the standalone CLI does not ship an OS
// recorder/playback adapter. These commands therefore diagnose that boundary
// instead of saving a decorative enabled bit that no runtime consumes.

import type { AppContext } from "../core/context.js";
import type { CommandFlags } from "../core/command_dispatch.js";
import type { Writable } from "node:stream";
import {
  detectTerminalCapabilities,
  voiceGesture,
  type TerminalCapabilities,
} from "../core/terminal_capabilities.js";
import {
  AETHER_VOICE_CLOUD_SHA,
  AETHER_VOICE_CONTRACT,
  DEFAULT_VOICE_SETTINGS,
} from "../core/voice.js";

export const VOICE_EXIT = {
  ok: 0,
  usage: 2,
  unavailable: 3,
} as const;

export interface VoiceCommandReport {
  contract: typeof AETHER_VOICE_CONTRACT;
  cloudCommit: typeof AETHER_VOICE_CLOUD_SHA;
  state: "off";
  defaultOff: true;
  runtime: "unavailable";
  host: TerminalCapabilities["host"];
  audioInput: boolean;
  audioOutput: boolean;
  keyReleaseEvents: boolean;
  interaction: string | null;
  typedInputAvailable: true;
  privacy: {
    captureRequiresExplicitStart: true;
    rawAudioPersistence: "forbidden";
    transcriptTelemetry: "forbidden";
  };
  missing: string[];
}

/** Pure, capability-truthful report shared by status, doctor, tests, and slash. */
export function voiceCommandReport(capabilities: TerminalCapabilities): VoiceCommandReport {
  const missing: string[] = [];
  if (!capabilities.audioInput) missing.push("microphone capture adapter is not bound");
  if (!capabilities.audioOutput) missing.push("audio playback adapter is not bound");
  // Even an embed capability hint is not proof that this standalone command
  // owns the actual ports. The host must inject those into TerminalSession.
  missing.push("standalone Voice session ports are not bound; embedded hosts must inject capture, playback, and their existing send bridge");
  return {
    contract: AETHER_VOICE_CONTRACT,
    cloudCommit: AETHER_VOICE_CLOUD_SHA,
    state: "off",
    defaultOff: true,
    runtime: "unavailable",
    host: capabilities.host,
    audioInput: capabilities.audioInput,
    audioOutput: capabilities.audioOutput,
    keyReleaseEvents: capabilities.keyReleaseEvents,
    interaction: voiceGesture(capabilities, DEFAULT_VOICE_SETTINGS.hotkey),
    typedInputAvailable: true,
    privacy: {
      captureRequiresExplicitStart: true,
      rawAudioPersistence: "forbidden",
      transcriptTelemetry: "forbidden",
    },
    missing,
  };
}

function renderHuman(report: VoiceCommandReport, doctor: boolean): string {
  const lines = [
    "AETHER VOICE",
    `  state:       ${report.state} (default-off)`,
    `  runtime:     ${report.runtime}`,
    `  host:        ${report.host}`,
    `  input:       ${report.audioInput ? "host reports available; ports not bound" : "unavailable"}`,
    `  output:      ${report.audioOutput ? "host reports available; ports not bound" : "unavailable"}`,
    `  interaction: ${report.interaction ?? "unavailable"}`,
    "  typed input: available",
    `  contract:    ${report.contract} @ ${report.cloudCommit.slice(0, 12)}`,
  ];
  if (doctor) {
    lines.push(
      "  privacy:     explicit start required; raw audio and transcript telemetry are not stored",
      "  prerequisites:",
      ...report.missing.map((item) => `    - ${item}`),
      "  recovery: continue with normal typed input; no provider or local route was changed",
    );
  } else {
    lines.push("  next:        aether voice doctor | aether voice settings");
  }
  return lines.join("\n") + "\n";
}

export interface VoiceCommandIo {
  out?: Pick<Writable, "write">;
  err?: Pick<Writable, "write">;
}

function write(ctx: AppContext, report: VoiceCommandReport, doctor: boolean, io: VoiceCommandIo): void {
  const out = io.out ?? process.stdout;
  if (ctx.flags.json) {
    out.write(JSON.stringify({ schemaVersion: 1, command: doctor ? "voice.doctor" : "voice.status", ...report }) + "\n");
  } else {
    out.write(renderHuman(report, doctor));
  }
}

export async function runVoiceCommand(
  ctx: AppContext,
  argv: string[],
  io: VoiceCommandIo = {},
): Promise<number> {
  const subcommand = (argv[0] ?? "status").toLowerCase();
  const capabilities = detectTerminalCapabilities();
  const report = voiceCommandReport(capabilities);
  switch (subcommand) {
    case "status":
      write(ctx, report, false, io);
      return VOICE_EXIT.ok;
    case "doctor":
    case "test":
      write(ctx, report, true, io);
      return VOICE_EXIT.unavailable;
    case "off":
      // There is no mounted standalone session in this one-shot process. The
      // truthful, idempotent state is already off and no file is mutated.
      write(ctx, report, false, io);
      return VOICE_EXIT.ok;
    case "on":
    case "toggle":
      write(ctx, report, true, io);
      if (!ctx.flags.json) {
        (io.err ?? process.stderr).write("Voice was not enabled: bind proven capture/playback ports first.\n");
      }
      return VOICE_EXIT.unavailable;
    case "settings": {
      const { runSettingsCommand } = await import("./settings.js");
      return runSettingsCommand(ctx, ["show", "Voice"], {}, io);
    }
    default:
      (io.err ?? process.stderr).write("usage: aether voice <status|on|off|toggle|test|doctor|settings>\n");
      return VOICE_EXIT.usage;
  }
}

export async function cmdVoice(ctx: AppContext, argv: string[], _flags: CommandFlags): Promise<number> {
  return runVoiceCommand(ctx, argv);
}
