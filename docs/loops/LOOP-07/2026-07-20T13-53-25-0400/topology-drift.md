# Topology drift

| service | documented node | actual node | drift | severity |
|---|---|---|---|---|
| Source control | GitHub `DBarr3/aether-agent` | GitHub `DBarr3/aether-agent` | None | LOW |
| Verification | GitHub-hosted Ubuntu and Windows runners | Workflow definitions added; remote run pending push | Remote execution not yet observed | MEDIUM |
| Release | `npm-production` environment | Workflow definition added; admin policy unreadable | Environment controls unverified | HIGH |
| Distribution | npm `aether-agents` | npm `aether-agents@0.1.0` | Automated release/provenance absent before this branch | HIGH, remediated in code |
| Runtime | End-user Node 24+ process | Package requires Node 24+ | None | LOW |

There are no repository-owned containers, daemons, public listeners, databases,
or SSH nodes. Hosted Aether API infrastructure is explicitly outside this repo.
