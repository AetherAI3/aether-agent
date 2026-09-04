/** Host facts used by terminal, settings, and voice surfaces.
 *
 * A plain TTY intentionally does not claim key-release or audio support. Those
 * capabilities must be injected by an xterm/Electron host (or a future proven
 * native adapter); feature copy is derived from this object rather than from a
 * guessed platform.
 */
export type TerminalHost = "tty" | "xterm-web" | "electron" | "headless";

export interface TerminalCapabilities {
  host: TerminalHost;
  columns: number;
  rows: number;
  color: boolean;
  unicode: boolean;
  mouse: boolean;
  keyReleaseEvents: boolean;
  audioInput: boolean;
  audioOutput: boolean;
}

export interface TerminalCapabilityOptions {
  host?: TerminalHost;
  columns?: number;
  rows?: number;
  color?: boolean;
  unicode?: boolean;
  mouse?: boolean;
  keyReleaseEvents?: boolean;
  audioInput?: boolean;
  audioOutput?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
}

const dimension = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) && value! > 0 ? Math.max(1, Math.floor(value!)) : fallback;

function hostFrom(value: string | undefined): TerminalHost | undefined {
  return value === "tty" || value === "xterm-web" || value === "electron" || value === "headless"
    ? value
    : undefined;
}

/** Detect only facts this process can prove. Embedders should pass explicit
 * overrides for browser/Electron key, mouse, and audio capabilities. */
export function detectTerminalCapabilities(options: TerminalCapabilityOptions = {}): TerminalCapabilities {
  const env = options.env ?? process.env;
  const stdoutIsTTY = options.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
  const stdinIsTTY = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const explicitHost = options.host ?? hostFrom(env["AETHER_TERMINAL_HOST"]);
  const host = explicitHost ?? (stdoutIsTTY && stdinIsTTY ? "tty" : "headless");
  const noColor = Object.prototype.hasOwnProperty.call(env, "NO_COLOR") || env["FORCE_COLOR"] === "0";
  const ascii = env["AETHER_ASCII"] === "1" || env["TERM"] === "dumb";

  return {
    host,
    columns: dimension(options.columns ?? process.stdout.columns, 80),
    rows: dimension(options.rows ?? process.stdout.rows, 24),
    color: options.color ?? (host !== "headless" && !noColor),
    unicode: options.unicode ?? !ascii,
    // A host label is discovery metadata, not an attestation that the bridge
    // actually forwards mouse or key-up events. Only explicit injected facts
    // may enable interaction copy or terminal modes that depend on them.
    mouse: options.mouse ?? false,
    keyReleaseEvents: options.keyReleaseEvents ?? false,
    // Never infer microphone/speaker access from a graphical host alone. The
    // host bridge must confirm that its adapters exist and permission can be
    // requested; otherwise Voice remains a truthful unavailable state.
    audioInput: options.audioInput ?? false,
    audioOutput: options.audioOutput ?? false,
  };
}

export type TerminalLayoutMode = "emergency" | "narrow" | "normal" | "wide";

export function terminalLayoutMode(capabilities: Pick<TerminalCapabilities, "columns" | "rows">): TerminalLayoutMode {
  if (capabilities.columns < 30 || capabilities.rows < 8) return "emergency";
  if (capabilities.columns < 72 || capabilities.rows < 18) return "narrow";
  if (capabilities.columns >= 120 && capabilities.rows >= 32) return "wide";
  return "normal";
}

/** Capability-truthful interaction copy. */
export function voiceGesture(
  capabilities: Pick<TerminalCapabilities, "audioInput" | "keyReleaseEvents">,
  hotkey: string,
): string | null {
  if (!capabilities.audioInput) return null;
  return capabilities.keyReleaseEvents
    ? `hold ${hotkey} to talk`
    : `press ${hotkey} to start/stop`;
}
