# Lane B — Terminal Settings Manifest

| Surface | Implementation | Contract | Evidence |
|---|---|---|---|
| Typed registry | `settings_registry.ts` | scopes/types/health, deterministic snapshots, staged single-use plans, exact confirmations, compensation, redacted export | registry/adapters/store suites |
| File authority | `settings_file_authority.ts`, stores/adapters | bounded fatal UTF-8 no-follow reads, regular-file checks, adjacent exclusive locks, CAS, exact rollback | hostile file/cancel tests |
| Terminal view | `settings_view.ts` | wide three-region and compact stacked layouts; keyboard-complete intents; secrets masked | 20x5–200x60 fixtures |
| Commands | `settings.ts`, shell/slash manifests | list/get/set/doctor/export/import-preview/reset; stable JSON; signals wait for compensation | command/docs tests |
| Section reset | settings command + registry transaction | case-insensitive section; writable-scope members; exact preview; cancel byte-identical; apply via normal receipt/rollback rail | 18/18 command tests |
| CI config | `aether_ci_settings.ts`, schema mirror | closed bounded safe JSON subset, duplicate/secret/control rejection, same-plan writes, lock/CAS/rollback | CI adapter tests |
| Domain composition | `settings_adapters.ts` | reuses existing Agent config, MCP store, skill settings, and doctors | no forked authority |

## Domain truth

| Domain | Functional authority | Explicit boundary |
|---|---|---|
| Agent / Aether Code | existing Agent config adapter | hosted Desktop-only controls absent |
| Appearance | runtime/env facts | capabilities are not inferred |
| MCP | existing store and bounded diagnostics | live broker OAuth not reproduced |
| Skills | canonical settings/trust ports | trust policy remains higher precedence |
| Ollama | existing model/config/doctor | adaptive continuity unavailable without runtime controller |
| Voice | writable only when injected consuming runtime and audio exist | standalone has no audio |
| Aether Online | optional doctor | unavailable without deployed port |
| Actions | optional authoritative doctor | no Agent runner engine |
| Aether CI | safe JSON-subset editor | unsupported YAML read-only; no named-check/command or runner authority |

A trusted single-adapter one-setting reset uses the registry's existing single-apply contract; rollback capability is required before any multi-setting plan. Real Online, Actions, Voice-device, live Ollama continuity, and external settings backends remain `UNPROVEN`.
