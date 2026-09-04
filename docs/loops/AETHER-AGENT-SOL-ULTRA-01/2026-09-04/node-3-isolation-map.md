# Node 3 — Isolation Map

| Repository | Branch | Base | Result |
|---|---|---|---|
| Aether Agent | `codex/sol-ultra-convergence-20260904` | `bb000edc4ca5c89891ac7352aaf688916ca58bc7` | one shared convergence checkout with logical leases |
| AETHER-CLOUD | `codex/agent-terminal-contracts-20260904` | `b4c1920ad48fcd4287610d0b5c60f5cdb8765a3e` | repository-isolated; PR #1483 at `ee60ab4` |
| Graph reconnaissance | `work/graph-spec/graphify-out` | supplied spec snapshot | derived artifacts only |

No database, billing, provider, package registry, tag, release, deployment, or `main` mutation occurred. Cloud PR #1483 remains open and green. The Agent PR/head is created only after local gates. Private per-unit worktrees were not used; that preferred isolation model remains an explicit deviation.

All source changes are recoverable by reverting commits. No user settings were applied while building the candidate.
