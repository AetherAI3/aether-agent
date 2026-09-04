import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  AETHER_VOICE_CLOUD_SHA,
  AETHER_VOICE_CONTRACT,
  DEFAULT_VOICE_SETTINGS,
  VOICE_STT_PATH,
  VOICE_TTS_PATH,
  VoicePlaybackQueue,
  initialVoiceMachine,
  reduceVoice,
  type SynthesizedAudio,
  type VoiceErrorKind,
  type VoicePlaybackPort,
} from "../src/core/voice.js";
import { MAX_VOICE_HINT_CHARS, MAX_VOICE_HINT_TERMS } from "../src/core/voice_transport.js";
import {
  AETHER_CI_CHECK_NAME_MAX_CHARS,
  AETHER_CI_CHECK_RUN_MAX_CHARS,
  AETHER_CI_CONFIG_MAX_BYTES,
  AETHER_CI_CONFIG_MAX_CHECKS,
  AETHER_CI_CONTRACT_COMMIT,
  AETHER_CI_CONTRACT_SHA256,
} from "../src/core/aether_ci_settings.js";

interface UpstreamProvenance {
  repository: string;
  path: string;
  commitSha: string;
  canonicalSha256: string;
}

interface VoiceFixture {
  schemaVersion: number;
  contractId: string;
  upstream: UpstreamProvenance;
  lifecycle: {
    states: string[];
    modes: string[];
    startModes: string[];
    errorKinds: string[];
    recoverableErrors: VoiceErrorKind[];
    terminalErrors: VoiceErrorKind[];
    turnDoneStateByMode: Record<string, string>;
    bargeInFrom: string[];
    bargeInState: string;
  };
  routes: {
    transcribe: {
      method: string;
      path: string;
      requestMediaType: string;
      requestFields: string[];
      successMediaType: string;
      successBodyRequired: string[];
      gatedStatuses: number[];
      providerFailureStatus: number;
    };
    speak: {
      method: string;
      path: string;
      requestMediaType: string;
      requestFields: string[];
      successMediaType: string;
      successHeaders: string[];
      gatedStatuses: number[];
      synthesisUnavailableStatus: number;
      synthesisUnavailableDisposition: string;
    };
  };
  playbackQueue: {
    sequenceOrigin: number;
    allocation: string;
    allocatedSequenceOutcomes: string[];
    ordering: string;
  };
  privacy: {
    captureRequiresExplicitStart: boolean;
    rawAudioPersistence: string;
    telemetryContent: string;
    ttsCacheControl: string;
    hintTermLimit: number;
    serializedHintCharacterLimit: number;
    browserPartials: {
      mayStreamAudioToBrowserProvider: boolean;
      optOutEnvironmentVariable: string;
      disabledValue: string;
    };
  };
  [key: string]: unknown;
}

const readJson = <T>(relative: string): T =>
  JSON.parse(readFileSync(resolve(process.cwd(), relative), "utf8")) as T;
const voiceFixture = readJson<VoiceFixture>("contracts/aether-cloud/voice-v1.json");
const ciSchema = readJson<Record<string, unknown>>("contracts/aether-cloud/aether-ci-config-v1.schema.json");
const voiceSource = readFileSync(resolve(process.cwd(), "src/core/voice.ts"), "utf8");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  }
  return value;
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function stringUnion(name: string): string[] {
  const match = voiceSource.match(new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`));
  assert.ok(match, `${name} must remain a string-literal union`);
  const body = match[1];
  assert.ok(body);
  return [...body.matchAll(/"([^"]+)"/g)]
    .map((item) => item[1])
    .filter((value): value is string => value !== undefined);
}

test("Cloud Voice fixture has immutable upstream provenance and exact copied data", () => {
  assert.equal(voiceFixture.schemaVersion, 1);
  assert.equal(voiceFixture.contractId, AETHER_VOICE_CONTRACT);
  assert.deepEqual(voiceFixture.upstream, {
    repository: "AetherAI3/AETHER-CLOUD",
    path: "contracts/voice/v1/portable-voice.json",
    commitSha: AETHER_VOICE_CLOUD_SHA,
    canonicalSha256: "6e801c40080e7b360fd33bdeb7bb679124a49a91619e92e56db543bb0a5c8ffe",
  });
  const { upstream: _upstream, ...copiedContract } = voiceFixture;
  assert.equal(canonicalDigest(copiedContract), voiceFixture.upstream.canonicalSha256);
});

test("Agent lifecycle types and reducer failure policy match Voice v1", () => {
  assert.deepEqual(stringUnion("CloudVoiceState"), voiceFixture.lifecycle.states);
  assert.deepEqual(stringUnion("VoiceMode"), voiceFixture.lifecycle.modes);
  assert.deepEqual(stringUnion("VoiceErrorKind"), voiceFixture.lifecycle.errorKinds);
  assert.deepEqual(
    voiceFixture.lifecycle.errorKinds.filter((kind) => !voiceFixture.lifecycle.recoverableErrors.includes(kind as VoiceErrorKind)),
    voiceFixture.lifecycle.terminalErrors,
  );

  const active = {
    ...initialVoiceMachine,
    state: "thinking" as const,
    mode: "conversation" as const,
    committed: "text answer remains visible",
  };
  for (const kind of voiceFixture.lifecycle.recoverableErrors) {
    const next = reduceVoice(active, { type: "PROVIDER_ERROR", kind, message: "degraded" });
    assert.equal(next.state, "listening", kind);
    assert.equal(next.committed, active.committed, kind);
  }
  for (const kind of voiceFixture.lifecycle.terminalErrors) {
    const next = reduceVoice(active, { type: "PROVIDER_ERROR", kind, message: "terminal" });
    assert.equal(next.state, "error", kind);
    assert.equal(next.mode, "idle", kind);
  }
});

test("Agent route constants and hint bounds match the frozen Cloud wire contract", () => {
  assert.deepEqual(voiceFixture.routes.transcribe, {
    method: "POST",
    path: VOICE_STT_PATH,
    requestMediaType: "multipart/form-data",
    requestFields: ["audio", "duration_s", "hints"],
    successMediaType: "application/json",
    successBodyRequired: ["text"],
    gatedStatuses: [401, 402],
    providerFailureStatus: 502,
  });
  assert.deepEqual(voiceFixture.routes.speak, {
    method: "POST",
    path: VOICE_TTS_PATH,
    requestMediaType: "application/json",
    requestFields: ["text", "voice", "purpose"],
    successMediaType: "audio/*",
    successHeaders: ["X-Aether-Voice-Model", "Cache-Control"],
    gatedStatuses: [401, 402],
    synthesisUnavailableStatus: 503,
    synthesisUnavailableDisposition: "degrade_speech_only",
  });
  assert.equal(MAX_VOICE_HINT_TERMS, voiceFixture.privacy.hintTermLimit);
  assert.equal(MAX_VOICE_HINT_CHARS, voiceFixture.privacy.serializedHintCharacterLimit);
});

test("Voice remains explicit/default-off and preserves the upstream privacy boundary", () => {
  assert.equal(DEFAULT_VOICE_SETTINGS.enabled, false);
  assert.equal(voiceFixture.privacy.captureRequiresExplicitStart, true);
  assert.equal(voiceFixture.privacy.rawAudioPersistence, "forbidden");
  assert.equal(voiceFixture.privacy.telemetryContent, "metadata_only_no_audio_or_transcript");
  assert.equal(voiceFixture.privacy.ttsCacheControl, "no-store");
  assert.deepEqual(voiceFixture.privacy.browserPartials, {
    mayStreamAudioToBrowserProvider: true,
    optOutEnvironmentVariable: "NEXT_PUBLIC_VOICE_BROWSER_PARTIALS",
    disabledValue: "0",
  });
  assert.equal(typeof DEFAULT_VOICE_SETTINGS.browserPartials, "boolean");
});

test("every allocated Agent playback index can be enqueued, skipped, or cancelled", async () => {
  assert.deepEqual(voiceFixture.playbackQueue, {
    sequenceOrigin: 0,
    allocation: "after_speakable_filter",
    allocatedSequenceOutcomes: ["enqueue", "skip", "cancel"],
    ordering: "strict",
  });
  const played: string[] = [];
  let stops = 0;
  const playback: VoicePlaybackPort = {
    id: "contract-fixture",
    async play(audio) { played.push(audio.model); },
    stop() { stops++; },
    dispose() {},
  };
  const queue = new VoicePlaybackQueue(playback);
  const first = queue.allocate();
  const skipped = queue.allocate();
  const third = queue.allocate();
  assert.equal(first, voiceFixture.playbackQueue.sequenceOrigin);
  const audio = (model: string): SynthesizedAudio => ({ bytes: new Uint8Array([1]), mime: "audio/wav", model });
  queue.enqueue(third, audio("third"));
  queue.skip(skipped);
  queue.enqueue(first, audio("first"));
  await queue.whenIdle();
  queue.assertSettled();
  assert.deepEqual(played, ["first", "third"]);

  queue.allocate();
  queue.cancel();
  queue.assertSettled();
  assert.equal(stops, 1);
});

test("Aether CI schema mirror is provenance-pinned and remains config-only", () => {
  const provenance = ciSchema["x-aether-upstream"] as UpstreamProvenance;
  assert.deepEqual(provenance, {
    repository: "AetherAI3/AETHER-CLOUD",
    path: "contracts/actions/v1/aether-ci-config.schema.json",
    commitSha: AETHER_CI_CONTRACT_COMMIT,
    canonicalSha256: AETHER_CI_CONTRACT_SHA256,
  });
  const { ["x-aether-upstream"]: _upstream, ...copiedSchema } = ciSchema;
  assert.equal(canonicalDigest(copiedSchema), provenance.canonicalSha256);
  assert.equal(ciSchema["additionalProperties"], false);
  assert.deepEqual(ciSchema["required"], ["version"]);
  const properties = ciSchema["properties"] as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(properties).sort(), ["checks", "gates", "project", "version"]);
  const version = properties["version"];
  assert.ok(version);
  assert.equal(version["const"], 1);
  assert.equal(ciSchema["x-aether-max-bytes"], AETHER_CI_CONFIG_MAX_BYTES);
  assert.equal(properties["checks"]?.["maxItems"], AETHER_CI_CONFIG_MAX_CHECKS);
  const checkItem = properties["checks"]?.["items"] as Record<string, unknown>;
  const checkProperties = checkItem["properties"] as Record<string, Record<string, unknown>>;
  assert.equal(checkProperties["name"]?.["maxLength"], AETHER_CI_CHECK_NAME_MAX_CHARS);
  assert.equal(checkProperties["run"]?.["maxLength"], AETHER_CI_CHECK_RUN_MAX_CHARS);
  assert.match(String(ciSchema["description"]), /does not grant runner-control authority/);
});
