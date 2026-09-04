# Node 0 — Open PR and Lease Map

## Cross-repository PR

Cloud PR [#1483](https://github.com/AetherAI3/AETHER-CLOUD/pull/1483) publishes portable Voice and CI configuration contracts. Its exact head is `ee60ab47f881b52e1779e7831282525b6c90c84d`; Voice contract bytes were introduced at `f91d677ece3c76c21a09db071ce796c5b2e8c6ea`. Required Cloud checks are green. The PR is not merged.

The Agent branch starts from `bb000edc4ca5c89891ac7352aaf688916ca58bc7`. No conflicting open Agent PR was adopted as an authority source; current repository code/contracts outranked stale plans.

## Logical leases used during implementation

| Lease | Owned leaves | Shared dependencies | Excluded authority |
|---|---|---|---|
| A-LIFECYCLE | turn/chat/code/transport tests and leaf code | render/error/tool executor contracts | settings/Voice |
| A-TERMINAL | event source, terminal session, TUI and tests | sinks/capabilities | command manifests |
| A-VOICE | Voice/capability/promo leaf modules and tests | Cloud mirrors, API client | provider/billing |
| B-SETTINGS | registry/store/file authority/adapters/view and tests | existing config/MCP/skills | Desktop IPC/runner |
| ROOT | commands, registries, public exports, docs, workflows, evidence | all frozen leaf contracts | merge/release |

Workers edited one shared Agent checkout under explicit file leases; repository-level isolation existed only between Agent and Cloud. Final `git diff --check`, generated-doc checks, and actual touched-set review are therefore mandatory.
