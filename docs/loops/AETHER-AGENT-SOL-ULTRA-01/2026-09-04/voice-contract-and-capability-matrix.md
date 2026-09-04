# Voice Contract and Capability Matrix

Contract: `aether.voice.portable.v1`
Voice source commit: `AetherAI3/AETHER-CLOUD@f91d677ece3c76c21a09db071ce796c5b2e8c6ea`
Current Cloud PR: [#1483](https://github.com/AetherAI3/AETHER-CLOUD/pull/1483) at `ee60ab47f881b52e1779e7831282525b6c90c84d`

| Area | Frozen behavior |
|---|---|
| States | idle, connecting, listening, user_speaking, processing, thinking, speaking, interrupted, error |
| Modes | idle, conversation, push |
| Errors | gated, mic_denied, mic_lost, stt_failed, tts_failed, agent_failed, disconnected, unsupported |
| STT | bearer `POST /agent/transcribe`; bounded multipart audio/duration/hints; typed 401/402 |
| TTS | bearer `POST /agent/voice/speak`; audio MIME plus required sanitized `X-Aether-Voice-Model` and exact `Cache-Control: no-store`; typed 401/402; 503 speech-only degradation |
| Queue | strict zero-origin allocation; every slot enqueue/skip/cancel |
| Privacy | explicit start; raw audio wiped/not persisted; telemetry excludes transcript/audio; hint bounds 48 terms/900 chars |

| Host fact | Advertised gesture/state |
|---|---|
| no proven audio input | unavailable/off; typed input remains |
| plain TTY with injected capture | press hotkey to start/stop |
| embed with capture plus key release | hold hotkey to talk |
| no playback | transcription possible; speech disabled/degraded |
| capture/playback/send bridge | full controller eligible through existing conversation path |

Defaults: disabled, toggle-to-talk, `Ctrl+Space`, auto voice, speech/partials enabled, 900 ms EOT, bounded 400–3000 ms. Invalid values fail rather than coerce.

No standalone OS recorder/player ships. Physical devices, browser partial provider, Electron permission UI, live network/provider model, real UVT charge, and live barge-in remain `UNPROVEN`.
