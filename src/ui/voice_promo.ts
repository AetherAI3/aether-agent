import type { TerminalCapabilities } from "../core/terminal_capabilities.js";
import { terminalLayoutMode, voiceGesture } from "../core/terminal_capabilities.js";
import type { TerminalVoiceState, VoiceSettings } from "../core/voice.js";
import { sanitizeTerm, sliceVisible, visibleWidth } from "./text.js";

export interface VoicePromoInput {
  capabilities: TerminalCapabilities;
  settings: VoiceSettings;
  state: TerminalVoiceState;
}

const stateLabel = (state: TerminalVoiceState): string => state.replaceAll("_", " ").toUpperCase();

function fit(line: string, columns: number, unicode: boolean): string {
  const safe = sanitizeTerm(line).replace(/[\r\n]+/g, " ");
  if (visibleWidth(safe) <= columns) return safe;
  if (columns <= 1) return sliceVisible(safe, Math.max(0, columns));
  const marker = unicode ? "…" : ".";
  return sliceVisible(safe, columns - 1) + marker;
}

/** Pure startup renderer. It never claims hold-to-talk or microphone support
 * unless the host capability object proves them. */
export function voicePromoLines(input: VoicePromoInput): string[] {
  const { capabilities, settings, state } = input;
  const mode = terminalLayoutMode(capabilities);
  const stateText = stateLabel(state);

  if (mode === "emergency") {
    return [fit(`Voice ${stateText.toLowerCase()} · /voice`, capabilities.columns, capabilities.unicode)];
  }
  if (mode === "narrow") {
    const action = capabilities.audioInput ? "/voice" : "/voice doctor";
    return [fit(`AETHER · Voice ${stateText.toLowerCase()} · ${action} · /settings`, capabilities.columns, capabilities.unicode)];
  }

  const first = `AETHER VOICE  [ ${stateText} ]${state === "off" ? "  Try Aether Voice" : ""}`;
  const gesture = voiceGesture(capabilities, sanitizeTerm(settings.hotkey));
  const second = gesture
    ? `/voice toggle · ${gesture} · /voice settings`
    : "/voice doctor · capture adapter unavailable · /voice settings";
  return [
    fit(first, capabilities.columns, capabilities.unicode),
    fit(second, capabilities.columns, capabilities.unicode),
  ];
}
