// @aether/cli public API — the universal LLM route, for embedding.
//
// Desktop (Aether Agent), web (Aether AI), and the terminal all import this and
// route chat through the same client. The CLI binary (src/main.ts) is just the
// terminal frontend over this same core.

export { AetherClient, createClient } from "./core/client.js";
export type { ClientOptions, ChatOptions } from "./core/client.js";
export { MAX_SSE_EVENT_BYTES, decodeSse, normalizeFrame, parseEvent } from "./core/stream.js";
export type { StreamFrame } from "./core/stream.js";
export { buildChatRequest } from "./core/envelope.js";
export type { ChatWireRequest } from "./core/envelope.js";
export type { CatalogItem, CatalogResponse } from "./types.js";
// chatStream() can throw StreamTimeoutError (a quiet connection); hintFor() maps it
// (and other thrown errors) to the same recovery hint the terminal CLI shows.
export { StreamEventTooLargeError, StreamTimeoutError } from "./core/errors.js";
export { hintFor } from "./core/error_hints.js";
export {
  TURN_STATES,
  TurnAlreadyFinalizedError,
  TurnLifecycle,
  TurnTransitionError,
  describeStreamFailure,
  isTerminalTurnState,
  recoverSubmittedPrompt,
} from "./core/turn_lifecycle.js";
export type {
  StreamFailureDescription,
  StreamFailureInput,
  TurnFinalization,
  TurnLifecycleOptions,
  TurnOutcome,
  TurnSnapshot,
  TurnState,
  TurnTerminalState,
} from "./core/turn_lifecycle.js";

// ---- Embed surface: render the real agent terminal into a host (desktop/web) ----
export {
  TERMINAL_SESSION_SNAPSHOT_VERSION,
  createTerminalSession,
} from "./ui/terminal_session.js";
export type {
  DetachableAgentSource,
  TerminalCompositionState,
  TerminalInputState,
  TerminalSession,
  TerminalSessionOptions,
  TerminalSessionSnapshot,
} from "./ui/terminal_session.js";
export { StdoutSink, StringSink } from "./ui/sink.js";
export type { RenderSink, StringSinkOptions } from "./ui/sink.js";
export { createTheme } from "./ui/theme.js";
export type { Theme } from "./ui/theme.js";
export { LocalAgentSource, mapBrainEvent } from "./core/agent_events.js";
export type { AgentSource, AgentEvent, EventSourceTerminal } from "./core/agent_events.js";

// ---- Portable terminal capability + Voice host boundary ----
export {
  detectTerminalCapabilities,
  terminalLayoutMode,
  voiceGesture,
} from "./core/terminal_capabilities.js";
export type {
  TerminalCapabilities,
  TerminalCapabilityOptions,
  TerminalHost,
  TerminalLayoutMode,
} from "./core/terminal_capabilities.js";
export {
  AETHER_VOICE_CLOUD_SHA,
  AETHER_VOICE_CONTRACT,
  DEFAULT_VOICE_SETTINGS,
  VOICE_STT_PATH,
  VOICE_TTS_PATH,
  VoicePlaybackQueue,
  initialVoiceMachine,
  reduceVoice,
  terminalVoiceState,
  validateVoiceSettings,
} from "./core/voice.js";
export type {
  AgentVoiceBridge,
  CapturedAudio,
  SynthesizedAudio,
  TerminalVoiceState,
  VoiceCapturePort,
  VoiceContextHints,
  VoiceErrorKind,
  VoiceInteractionMode,
  VoiceLocalFallback,
  VoiceMachine,
  VoiceMode,
  VoicePlaybackPort,
  VoiceProfile,
  VoiceSettings,
  VoiceTransport,
} from "./core/voice.js";
export {
  VoiceSessionController,
  VoiceSessionDisposedError,
  VoiceSessionStateError,
  describeVoiceSessionFailure,
} from "./core/voice_session.js";
export type {
  VoiceSessionCallbacks,
  VoiceSessionDependencies,
  VoiceSessionFailure,
  VoiceSessionFailureStage,
  VoiceSessionResourceSnapshot,
  VoiceSessionSnapshot,
} from "./core/voice_session.js";
export {
  CloudVoiceTransport,
  MAX_VOICE_HINT_CHARS,
  MAX_VOICE_HINT_TERMS,
  VoiceProtocolError,
  serializeVoiceHints,
} from "./core/voice_transport.js";
export { voicePromoLines } from "./ui/voice_promo.js";
export type { VoicePromoInput } from "./ui/voice_promo.js";

// ---- Typed settings host boundary ----
export {
  DEFAULT_SETTINGS_OPERATION_TIMEOUT_MS,
  HEALTH_STATES,
  MAX_SETTINGS_OPERATION_TIMEOUT_MS,
  SETTINGS_SCHEMA_VERSION,
  SETTING_SCOPES,
  SETTING_SCOPE_PRECEDENCE,
  WRITABLE_SETTING_SCOPES,
  SettingsRegistry,
  SettingsTransaction,
  booleanValidator,
  enumValidator,
  finiteNumberValidator,
  pathValidator,
  redactSettingsArtifact,
  secretReference,
  secretReferenceValidator,
  settingsPlanToRedactedJson,
  stableJsonStringify,
  stringValidator,
} from "./core/settings_registry.js";
export type {
  AdapterApplyReceipt,
  AdapterApplyResult,
  ApplyFailure,
  ApplyFailureKind,
  ApplyOptions,
  AppliedSettingReceipt,
  CancelReceipt,
  ConfirmationMetadata,
  ConfirmationResolver,
  EffectiveLayer,
  EffectiveSetting,
  HealthState,
  KnownEffectiveLayer,
  KnownEffectiveSetting,
  PlannedSettingChange,
  RedactedEffectiveValue,
  RedactedLayer,
  RedactedSetting,
  RedactedSettingsExport,
  RequiredConfirmation,
  RollbackOutcome,
  SecretReference,
  SettingChange,
  SettingsChangePreview,
  SettingDefinition,
  SettingDescriptor,
  SettingHealth,
  SettingImpact,
  SettingLayer,
  SettingOperation,
  SettingsOperationContext,
  SettingsOperationTimer,
  SettingsPlanOptions,
  SettingPlanContext,
  SettingReadResult,
  SettingScope,
  SettingValue,
  SettingValueType,
  SettingsApplyPlan,
  SettingsBatchReceipt,
  SettingsCancellationReceipt,
  SettingsRegistryOptions,
  SettingsSnapshot,
  SnapshotOptions,
  StageResult,
  UnknownEffectiveLayer,
  UnknownEffectiveSetting,
  UnsetEffectiveSetting,
  ValidationIssue,
  ValidationResult,
  WritableSettingScope,
} from "./core/settings_registry.js";
export {
  SETTINGS_STORE_MAX_BYTES,
  SETTINGS_STORE_SCHEMA_VERSION,
  VersionedSettingsStore,
} from "./core/settings_store.js";
export type {
  SettingsStoreApplyReceipt,
  SettingsStoreInspection,
  SettingsStoreOptions,
  SettingsStorePaths,
  SettingsStorePlan,
  SettingsStoreRollbackReceipt,
  SettingsStoreRollbackToken,
  SettingsStoreStatus,
} from "./core/settings_store.js";
export {
  ACTIONS_CI_PREREQUISITE,
  ACTIONS_RUNNER_PREREQUISITE,
  ADAPTIVE_CONTEXT_PREREQUISITE,
  ONLINE_SETTINGS_PREREQUISITE,
  VOICE_SETTINGS_PREREQUISITE,
  createAgentSettingsRegistry,
} from "./core/settings_adapters.js";
export type {
  AgentConfigPort,
  AgentSettingsAdapterDependencies,
  OllamaSettingsSnapshot,
  ServiceSettingsSnapshot,
  SkillSettingsPort,
  VoiceSettingsRuntime,
} from "./core/settings_adapters.js";
export {
  AETHER_CI_CHECK_NAME_MAX_CHARS,
  AETHER_CI_CHECK_RUN_MAX_CHARS,
  AETHER_CI_CONFIG_MAX_BYTES,
  AETHER_CI_CONFIG_MAX_CHECKS,
  AETHER_CI_CONFIG_SCHEMA_VERSION,
  AETHER_CI_CONTRACT_COMMIT,
  AETHER_CI_CONTRACT_SHA256,
  canonicalAetherCiJson,
  inspectAetherCiConfig,
  parseAetherCiJson,
} from "./core/aether_ci_settings.js";
export type {
  AetherCiCheck,
  AetherCiCheckType,
  AetherCiConfig,
  AetherCiConfigInspection,
  AetherCiConfigStatus,
  AetherCiGate,
  AetherCiParseResult,
} from "./core/aether_ci_settings.js";
export {
  initialSettingsViewState,
  renderSettingsView,
  stepSettingsView,
} from "./ui/settings_view.js";
export type {
  SettingViewDescriptor,
  SettingsFocus,
  SettingsViewIntent,
  SettingsViewModel,
  SettingsViewState,
  SettingsViewStep,
} from "./ui/settings_view.js";
