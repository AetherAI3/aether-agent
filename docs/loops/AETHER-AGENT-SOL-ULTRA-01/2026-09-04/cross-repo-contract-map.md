# Cross-Repository Contract Map

| Contract | Cloud authority | Agent consumer | Proven relation | Remaining boundary |
|---|---|---|---|---|
| Portable Voice v1 | Cloud PR #1483 contract at `f91d677...` | `contracts/aether-cloud/voice-v1.json`, Voice types/session | canonical bytes/hash and lifecycle/routes/privacy/queue fixture | PR not merged; live devices unproven |
| Voice STT | Cloud `/agent/transcribe` | `CloudVoiceTransport.transcribe` | multipart shape, bounds, typed 401/402, cleanup | deployed billing/account unproven |
| Voice TTS | Cloud `/agent/voice/speak` | `CloudVoiceTransport.synthesize` | audio type, required model provenance, exact no-store policy, typed 402/503 | provider/cost Cloud-owned |
| Conversation bridge | existing host send path | injected `AgentVoiceBridge` | final speech enters the same send path once | no in-repo Desktop/web adapter |
| `.aether-ci.yml` v1 | Cloud parser/schema at PR head `ee60ab4...` | safe JSON-subset parser/editor and schema mirror | canonical schema hash `18c718d6359ae421ef18990bd4570af03901b581fe7bb3819c7189945d16d69c`; closed, bounded, CAS/lock/rollback | YAML outside safe subset is read-only; no runner control |
| Actions execution | Cloud Desktop/Electron engine | read-only availability/doctor setting | non-import/non-fork boundary tested | intentionally unavailable in standalone Agent |
| Aether Online | deployed service | optional doctor port | absence is explicit `unavailable` | endpoint/canary not supplied |

## Dependency order

1. Review Cloud PR #1483 at `ee60ab47f881b52e1779e7831282525b6c90c84d`; Voice bytes remain provenance-pinned to the introducing commit `f91d677ece3c76c21a09db071ce796c5b2e8c6ea`.
2. Review the Agent PR and its mirror tests at its exact PR head.
3. If Cloud contract bytes change, update Agent provenance and rerun both exact heads.
4. Merge only after separate human authorization; this record does not merge either repository.

Cloud and Agent `main` remain untouched.
