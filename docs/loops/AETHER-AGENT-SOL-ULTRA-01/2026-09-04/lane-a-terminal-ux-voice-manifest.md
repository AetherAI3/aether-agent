# Lane A — Terminal UX and Voice Manifest

| Surface | Implementation | Contract | Evidence |
|---|---|---|---|
| Turn lifecycle | `turn_lifecycle.ts`, chat/code callers | strict states, stable ID, one terminal result; brain completion advisory until host verification | lifecycle/402/EOF/error/cancel tests |
| Bounded execution | chat/code/transport/verify gate | finite production defaults; meaningful progress only; signal reaches tool and verifier; cleanup cannot replace primary error | alternating frames, delimiter-free SSE, parked iterator, hung tool |
| Event/remount | `agent_events.ts`, `terminal_session.ts` | atomic `subscribeAfter`, exact replay, gap refusal, preserved watchdog deadline, one outcome owner | focused terminal 48/48 |
| Pager/resize model | `tui_layout.ts` | stable logical anchor, coalesced resize, hostile metric clamps, idempotent mount | deterministic TUI tests; no live caller |
| Capabilities | `terminal_capabilities.ts` | host facts only; no inferred audio/key release | dimension and gesture tests |
| Voice contract | `voice.ts`, Cloud mirror | Cloud states/routes/privacy/queue pinned to `f91d677...` | canonical hash fixture |
| Voice orchestration | `voice_session.ts`, `voice_transport.ts` | explicit/default-off capture; same send bridge; ordered cancel/barge-in; independent speech failure | 52/52 Voice tests |
| Voice presentation | Voice promo/command/splash/slash | compact truthful copy; never claims hold without key-release attestation | 20x5 through 200x60 |

## Authority and limits

Cloud owns provider selection, credentials, billing, STT/TTS routes, and the portable source contract. The Agent requires TTS model provenance and exact `no-store`; a bad response body is cancelled. Standalone Agent ships no OS audio ports and reports Voice unavailable. Embedded hosts must inject capture, playback, transport, and their existing conversation bridge.

Physical audio, browser partial recognition, Electron permission and remount behavior, deployed 402 billing, live barge-in timing, and a production `TuiLayout` caller remain `UNPROVEN`.
