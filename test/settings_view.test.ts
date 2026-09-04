import assert from "node:assert/strict";
import { test } from "node:test";

import type { EffectiveSetting, SettingsSnapshot } from "../src/core/settings_registry.js";
import { visibleWidth } from "../src/ui/text.js";
import {
  initialSettingsViewState,
  renderSettingsView,
  stepSettingsView,
  type SettingsViewModel,
} from "../src/ui/settings_view.js";

function effective(
  id: string,
  section: string,
  value: boolean | number | string,
  health: EffectiveSetting["health"]["state"] = "configured",
): EffectiveSetting {
  return {
    id,
    section,
    valueType: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string",
    state: "known",
    value,
    scope: "global",
    source: "global settings",
    precedence: [{ state: "known", scope: "global", source: "global settings", rank: 1, value }],
    health: { state: health, summary: `${health} evidence` },
    extensions: {},
  };
}

const snapshot: SettingsSnapshot = {
  schemaVersion: 1,
  settings: {
    "appearance.unicode": effective("appearance.unicode", "Appearance", true, "verified"),
    "voice.enabled": effective("voice.enabled", "Voice", false, "configured"),
    "voice.profile": effective("voice.profile", "Voice", "auto", "reachable"),
    "online.remote_execution": {
      id: "online.remote_execution",
      section: "Aether Online",
      valueType: "boolean",
      state: "unset",
      precedence: [],
      health: { state: "unavailable", summary: "no deployed write contract" },
      extensions: {},
    },
    "mcp.oauth": {
      id: "mcp.oauth",
      section: "MCP & Connectors",
      valueType: "secret_ref",
      state: "known",
      value: { kind: "secret_ref", provider: "env", name: "SYNTHETIC_TOKEN" },
      scope: "env",
      source: "environment",
      precedence: [{
        state: "known",
        scope: "env",
        source: "environment",
        rank: 4,
        value: { kind: "secret_ref", provider: "env", name: "SYNTHETIC_TOKEN" },
      }],
      health: { state: "unknown" },
      extensions: {},
    },
  },
  unknownSettings: {},
  extensions: {},
};

const model: SettingsViewModel = {
  snapshot,
  descriptors: [
    { id: "appearance.unicode", label: "Unicode glyphs", description: "Use Unicode borders when the host proves support.", scopes: ["global", "project"] },
    { id: "voice.enabled", label: "Aether Voice", description: "Default-off voice input; typed input is always available.", scopes: ["global"] },
    { id: "voice.profile", label: "Voice profile", description: "Cloud-routed presentation profile, never a provider selector.", scopes: ["global"] },
    { id: "online.remote_execution", label: "Remote execution", description: "Unavailable until a deployed entitled write API exists.", scopes: ["server_policy"] },
    { id: "mcp.oauth", label: "OAuth credential", description: "Reference presence only.", sensitive: true, scopes: ["env"] },
  ],
};

for (const [columns, rows] of [[20, 5], [40, 12], [80, 24], [120, 40], [200, 60]] as const) {
  test(`settings view fits ${columns}x${rows} with Apply/Cancel controls reachable`, () => {
    const state = initialSettingsViewState(model);
    const lines = renderSettingsView(model, state, { columns, rows, unicode: true });
    assert.ok(lines.length <= rows);
    assert.ok(lines.every((line) => visibleWidth(line) <= columns), `all rows fit ${columns} columns`);
    assert.match(lines.join("\n"), /Esc (?:close|cancel)/);
    assert.ok(!lines.join("\n").includes("SYNTHETIC_TOKEN"), "secret reference name never renders");
  });
}

test("wide settings view has three regions and truthful health/source language", () => {
  const state = { ...initialSettingsViewState(model), section: "Aether Online", selectedId: "online.remote_execution" };
  const output = renderSettingsView(model, state, { columns: 120, rows: 40, unicode: false }).join("\n");
  assert.match(output, /AETHER SETTINGS  WIDE/);
  assert.match(output, /unavailable/);
  assert.match(output, /no source/);
  assert.match(output, /\|.*\|.*\|.*\|/, "ASCII three-column frame remains readable without Unicode");
});

test("wide settings view scrolls both regions so the active section and selected setting stay visible", () => {
  const settings = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => {
      const suffix = String(index).padStart(2, "0");
      return [`setting.${suffix}`, effective(`setting.${suffix}`, "Section 29", suffix)];
    }),
  );
  for (let index = 0; index < 29; index++) {
    const suffix = String(index).padStart(2, "0");
    settings[`section-marker.${suffix}`] = effective(`section-marker.${suffix}`, `Section ${suffix}`, true);
  }
  const crowded: SettingsViewModel = {
    snapshot: { schemaVersion: 1, settings, unknownSettings: {}, extensions: {} },
    descriptors: Object.keys(settings).map((id) => ({ id, label: id, description: id, scopes: ["global"] })),
  };
  const state = {
    ...initialSettingsViewState(crowded),
    section: "Section 29",
    selectedId: "setting.29",
  };
  const output = renderSettingsView(crowded, state, { columns: 120, rows: 32, unicode: false }).join("\n");
  assert.match(output, /> Section 29/);
  assert.match(output, />   setting\.29/);
});

test("keyboard reducer is complete for navigation, search, edit, toggle, apply, cancel, and help", () => {
  let state = { ...initialSettingsViewState(model), section: "Appearance", selectedId: "appearance.unicode" };
  let step = stepSettingsView(state, "space", model);
  assert.deepEqual(step.intent, { type: "toggle", settingId: "appearance.unicode", scope: "global", value: false });
  step = stepSettingsView(step.state, "enter", model);
  assert.deepEqual(step.intent, { type: "edit", settingId: "appearance.unicode", scope: "global" });
  step = stepSettingsView(step.state, "/", model);
  assert.equal(step.state.searching, true);
  step = stepSettingsView(step.state, "u", model);
  assert.equal(step.state.query, "u");
  step = stepSettingsView(step.state, "escape", model);
  assert.equal(step.state.query, "");
  step = stepSettingsView(step.state, "?", model);
  assert.equal(step.state.help, true);
  assert.equal(stepSettingsView(step.state, "ctrl-s", model).intent.type, "apply");
  assert.equal(stepSettingsView({ ...step.state, help: false }, "escape", model).intent.type, "close");
});

test("read-only settings cannot produce edit or toggle intents", () => {
  const state = {
    ...initialSettingsViewState(model),
    section: "Aether Online",
    selectedId: "online.remote_execution",
  };
  const edit = stepSettingsView(state, "enter", model);
  assert.equal(edit.intent.type, "render");
  assert.match(edit.state.message ?? "", /read-only/i);
  const toggle = stepSettingsView(state, "space", model);
  assert.equal(toggle.intent.type, "render");
});

test("human settings renderer strips controls from project-owned metadata", () => {
  const hostile: SettingsViewModel = {
    ...model,
    descriptors: model.descriptors?.map((descriptor) =>
      descriptor.id === "voice.enabled"
        ? {
            ...descriptor,
            label: "Voice\u001b]52;c;clipboard\u0007",
            description: "safe\u009b2J description",
          }
        : descriptor),
  };
  const state = {
    ...initialSettingsViewState(hostile),
    section: "Voice",
    selectedId: "voice.enabled",
  };
  const output = renderSettingsView(hostile, state, { columns: 120, rows: 40, unicode: true }).join("\n");
  assert.match(output, /Voice/);
  assert.doesNotMatch(output, /[\u001b\u0007\u009b]/);
});
