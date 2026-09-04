import type {
  EffectiveSetting,
  HealthState,
  SettingScope,
  SettingsChangePreview,
  WritableSettingScope,
  SettingsSnapshot,
} from "../core/settings_registry.js";
import { terminalLayoutMode, type TerminalCapabilities } from "../core/terminal_capabilities.js";
import { sanitizeTerm, sliceVisible, visibleWidth, wrapVisible } from "./text.js";

export type SettingsFocus = "sections" | "settings" | "details";

export interface SettingsViewState {
  readonly focus: SettingsFocus;
  readonly section: string | null;
  readonly selectedId: string | null;
  readonly query: string;
  readonly searching: boolean;
  readonly help: boolean;
  readonly message?: string;
}

export interface SettingViewDescriptor {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
  readonly sensitive?: boolean;
  readonly requiresRestart?: boolean;
  readonly scopes?: readonly SettingScope[];
}

export interface SettingsViewModel {
  readonly snapshot: SettingsSnapshot;
  readonly staged?: readonly SettingsChangePreview[];
  readonly descriptors?: readonly SettingViewDescriptor[];
}

export type SettingsViewIntent =
  | { readonly type: "render" }
  | { readonly type: "edit"; readonly settingId: string; readonly scope: WritableSettingScope }
  | { readonly type: "toggle"; readonly settingId: string; readonly scope: WritableSettingScope; readonly value: boolean }
  | { readonly type: "apply" }
  | { readonly type: "cancel" }
  | { readonly type: "close" }
  | { readonly type: "none" };

export interface SettingsViewStep {
  readonly state: SettingsViewState;
  readonly intent: SettingsViewIntent;
}

interface Row {
  id: string;
  section: string;
  label: string;
  description: string;
  sensitive: boolean;
  requiresRestart: boolean;
  writableScope: WritableSettingScope | null;
  effective: EffectiveSetting;
  staged: SettingsChangePreview | null;
}

export function initialSettingsViewState(model: SettingsViewModel): SettingsViewState {
  const rows = viewRows(model, { section: null, query: "" });
  return {
    focus: "settings",
    section: rows[0]?.section ?? null,
    selectedId: rows[0]?.id ?? null,
    query: "",
    searching: false,
    help: false,
  };
}

function descriptorMap(model: SettingsViewModel): Map<string, SettingViewDescriptor> {
  return new Map((model.descriptors ?? []).map((descriptor) => [descriptor.id, descriptor]));
}

function viewRows(
  model: SettingsViewModel,
  filter: Pick<SettingsViewState, "section" | "query">,
): Row[] {
  const descriptors = descriptorMap(model);
  const staged = new Map((model.staged ?? []).map((change) => [change.settingId, change]));
  const query = filter.query.trim().toLocaleLowerCase("en-US");
  return Object.entries(model.snapshot.settings)
    .map(([id, effective]): Row => {
      const descriptor = descriptors.get(id);
      return {
        id,
        section: effective.section,
        label: descriptor?.label ?? id,
        description: descriptor?.description ?? id,
        sensitive: descriptor?.sensitive ?? effective.valueType === "secret_ref",
        requiresRestart: descriptor?.requiresRestart ?? false,
        writableScope: writableScope(descriptor?.scopes),
        effective,
        staged: staged.get(id) ?? null,
      };
    })
    .filter((row) => (!filter.section || row.section === filter.section) &&
      (!query || `${row.id} ${row.label} ${row.description} ${row.section}`.toLocaleLowerCase("en-US").includes(query)))
    .sort((left, right) => `${left.section}\0${left.id}`.localeCompare(`${right.section}\0${right.id}`));
}

function writableScope(scopes: readonly SettingScope[] | undefined): WritableSettingScope | null {
  // Compatibility for third-party view models created before descriptors
  // exposed scopes. Production registry descriptors always include them.
  if (scopes === undefined) return "global";
  for (const scope of ["global", "project", "session"] as const) {
    if (scopes.includes(scope)) return scope;
  }
  return null;
}

function allSections(model: SettingsViewModel): string[] {
  return [...new Set(Object.values(model.snapshot.settings).map((setting) => setting.section))].sort();
}

function selectedIndex(rows: readonly Row[], state: SettingsViewState): number {
  const index = rows.findIndex((row) => row.id === state.selectedId);
  return index < 0 ? 0 : index;
}

function viewportStart(selected: number, total: number, height: number): number {
  return Math.max(0, Math.min(selected, Math.max(0, total - height)));
}

function settle(state: SettingsViewState, model: SettingsViewModel): SettingsViewState {
  const sections = allSections(model);
  const section = state.section && sections.includes(state.section) ? state.section : (sections[0] ?? null);
  const rows = viewRows(model, { section, query: state.query });
  return { ...state, section, selectedId: rows.some((row) => row.id === state.selectedId) ? state.selectedId : (rows[0]?.id ?? null) };
}

export function stepSettingsView(
  current: SettingsViewState,
  key: string,
  model: SettingsViewModel,
): SettingsViewStep {
  let state = settle(current, model);
  if (state.searching) {
    if (key === "escape") return { state: settle({ ...state, searching: false, query: "" }, model), intent: { type: "render" } };
    if (key === "enter") return { state: { ...state, searching: false }, intent: { type: "render" } };
    if (key === "backspace") return { state: settle({ ...state, query: state.query.slice(0, -1) }, model), intent: { type: "render" } };
    if (key.length === 1 && key >= " ") return { state: settle({ ...state, query: state.query + key }, model), intent: { type: "render" } };
    return { state, intent: { type: "none" } };
  }
  if (key === "?") return { state: { ...state, help: !state.help }, intent: { type: "render" } };
  if (key === "/") return { state: { ...state, searching: true, query: "" }, intent: { type: "render" } };
  if (key === "tab") {
    const order: SettingsFocus[] = ["sections", "settings", "details"];
    return { state: { ...state, focus: order[(order.indexOf(state.focus) + 1) % order.length]! }, intent: { type: "render" } };
  }
  if (key === "ctrl-s") return { state, intent: { type: "apply" } };
  if (key === "escape") {
    if (state.help) return { state: { ...state, help: false }, intent: { type: "render" } };
    if ((model.staged?.length ?? 0) > 0) return { state, intent: { type: "cancel" } };
    return { state, intent: { type: "close" } };
  }
  if (state.focus === "sections" && ["up", "down", "j", "k"].includes(key)) {
    const sections = allSections(model);
    const at = Math.max(0, sections.indexOf(state.section ?? ""));
    const delta = key === "up" || key === "k" ? -1 : 1;
    const section = sections[Math.max(0, Math.min(sections.length - 1, at + delta))] ?? null;
    return { state: settle({ ...state, section }, model), intent: { type: "render" } };
  }
  const rows = viewRows(model, state);
  if (["up", "down", "j", "k"].includes(key)) {
    const at = selectedIndex(rows, state);
    const delta = key === "up" || key === "k" ? -1 : 1;
    const row = rows[Math.max(0, Math.min(rows.length - 1, at + delta))];
    return { state: { ...state, selectedId: row?.id ?? null }, intent: { type: "render" } };
  }
  const row = rows[selectedIndex(rows, state)];
  if (!row) return { state, intent: { type: "none" } };
  if ((key === "enter" || key === "space") && row.writableScope === null) {
    return {
      state: { ...state, message: "read-only: this setting has no writable local scope" },
      intent: { type: "render" },
    };
  }
  if (key === "enter") {
    return { state, intent: { type: "edit", settingId: row.id, scope: row.writableScope! } };
  }
  if (key === "space" && row.effective.valueType === "boolean" && row.effective.state === "known") {
    return {
      state,
      intent: { type: "toggle", settingId: row.id, scope: row.writableScope!, value: !Boolean(row.effective.value) },
    };
  }
  return { state, intent: { type: "none" } };
}

const HEALTH_MARK: Readonly<Record<HealthState, string>> = {
  unconfigured: "○ unconfigured",
  configured: "◐ configured",
  reachable: "◒ reachable",
  verified: "● verified",
  degraded: "! degraded",
  unavailable: "× unavailable",
  disabled_by_policy: "⊘ policy",
  unknown: "? unknown",
};

function printableValue(row: Row): string {
  if (row.sensitive) return "[secret reference hidden]";
  if (row.effective.state === "unset") return "[unset]";
  if (row.effective.state === "unknown") return "[unknown]";
  return typeof row.effective.value === "object" ? "[reference]" : String(row.effective.value);
}

function pad(value: string, width: number): string {
  const sliced = sliceVisible(value, Math.max(0, width));
  return sliced + " ".repeat(Math.max(0, width - visibleWidth(sliced)));
}

function frameLine(parts: readonly string[], widths: readonly number[], unicode: boolean): string {
  const vertical = unicode ? "│" : "|";
  return vertical + parts.map((part, index) => ` ${pad(part, Math.max(0, (widths[index] ?? 0) - 2))} `).join(vertical) + vertical;
}

function horizontal(widths: readonly number[], unicode: boolean, position: "top" | "middle" | "bottom"): string {
  const glyphs = unicode
    ? position === "top" ? ["┌", "┬", "┐"] : position === "bottom" ? ["└", "┴", "┘"] : ["├", "┼", "┤"]
    : ["+", "+", "+"];
  return glyphs[0] + widths.map((width) => (unicode ? "─" : "-").repeat(width)).join(glyphs[1]) + glyphs[2];
}

function clampLines(lines: readonly string[], columns: number, rows: number): string[] {
  // Human settings content can include project-owned skill metadata. Strip all
  // terminal controls at the final renderer ingress; structured JSON remains
  // unchanged apart from the registry's secret redaction contract.
  return lines
    .slice(0, Math.max(1, rows))
    .map((line) => sliceVisible(sanitizeTerm(line), Math.max(1, columns)));
}

/** Pure renderer: wide terminals get section/setting/detail regions; narrow
 * hosts get a stacked drill-down. Semantic health words survive NO_COLOR. */
export function renderSettingsView(
  model: SettingsViewModel,
  inputState: SettingsViewState,
  capabilities: Pick<TerminalCapabilities, "columns" | "rows" | "unicode">,
): string[] {
  const state = settle(inputState, model);
  const rows = viewRows(model, state);
  const selected = rows[selectedIndex(rows, state)];
  const stagedCount = model.staged?.length ?? 0;
  const mode = terminalLayoutMode(capabilities);
  const search = state.searching ? `  SEARCH: ${state.query || "_"}` : state.query ? `  filter: ${state.query}` : "";
  const title = `AETHER SETTINGS  ${mode.toUpperCase()}${search}`;
  const controls = mode === "emergency"
    ? (stagedCount ? "^S apply · Esc cancel" : "/ search · Esc close")
    : mode === "narrow"
      ? (stagedCount ? "Ctrl+S apply · Esc cancel · ? help" : "↑↓ · Enter · / search · Esc close · ?")
      : stagedCount
        ? `${stagedCount} staged · Ctrl+S apply · Esc cancel · ? help`
        : `/ search · Enter edit · Space toggle · Esc close · ? help`;
  if (mode === "wide") {
    const inner = Math.max(20, capabilities.columns - 4);
    const sectionW = Math.max(16, Math.floor(inner * 0.2));
    const settingW = Math.max(28, Math.floor(inner * 0.38));
    const detailW = Math.max(20, inner - sectionW - settingW);
    const widths = [sectionW, settingW, detailW];
    const sections = allSections(model);
    const contentHeight = Math.max(1, capabilities.rows - 5);
    const settingStart = viewportStart(selectedIndex(rows, state), rows.length, contentHeight);
    const activeSection = Math.max(0, sections.indexOf(state.section ?? ""));
    const sectionStart = viewportStart(activeSection, sections.length, contentHeight);
    const lines = [title, horizontal(widths, capabilities.unicode, "top")];
    for (let index = 0; index < contentHeight; index++) {
      const section = sections[sectionStart + index];
      const row = rows[settingStart + index];
      const sectionText = section ? `${section === state.section ? ">" : " "} ${section}` : "";
      const settingText = row ? `${row.id === selected?.id ? ">" : " "} ${row.staged ? "*" : " "} ${row.label}` : "";
      let detail = "";
      if (index === 0 && selected) detail = `${HEALTH_MARK[selected.effective.health.state]}${selected.requiresRestart ? " · restart" : ""}${selected.writableScope ? "" : " · read-only"}`;
      else if (index === 1 && selected) detail = `value: ${printableValue(selected)}`;
      else if (index === 2 && selected) detail = selected.effective.state === "unset"
        ? "source: no source"
        : `source: ${selected.effective.source} (${selected.effective.scope})`;
      else if (index >= 3 && selected) detail = wrapVisible(selected.description, Math.max(1, detailW - 2))[index - 3] ?? "";
      lines.push(frameLine([sectionText, settingText, detail], widths, capabilities.unicode));
    }
    lines.push(horizontal(widths, capabilities.unicode, "bottom"), controls);
    return clampLines(lines, capabilities.columns, capabilities.rows);
  }

  const lines = [title];
  if (mode !== "emergency") lines.push(`${state.section ?? "No section"}  ·  ${rows.length} setting(s)`);
  const reserve = mode === "emergency" ? 2 : 5;
  const listHeight = Math.max(1, capabilities.rows - reserve);
  const at = selectedIndex(rows, state);
  const start = Math.max(0, Math.min(at, rows.length - listHeight));
  for (const row of rows.slice(start, start + listHeight)) {
    lines.push(`${row.id === selected?.id ? ">" : " "} ${row.staged ? "*" : " "} ${row.label}: ${printableValue(row)} [${row.effective.health.state}]`);
  }
  if (mode !== "emergency" && selected) {
    lines.push(`${HEALTH_MARK[selected.effective.health.state]} · ${selected.effective.state === "unset" ? "no source" : `${selected.effective.scope}/${selected.effective.source}`}`);
    lines.push(...wrapVisible(selected.description, Math.max(1, capabilities.columns)).slice(0, 1));
  }
  if (state.message && mode !== "emergency") lines.push(state.message);
  lines.push(controls);
  return clampLines(lines, capabilities.columns, capabilities.rows);
}
