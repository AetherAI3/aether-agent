# Headless agent protocol

`aether exec [flags] "task"` is the non-interactive, local-only agent surface. The name is deliberately separate from the existing hosted-orchestrator `aether run` and human TUI `aether agent` commands. It starts a Node child shipped inside the npm package; that child drives local Ollama. It never opens a TTY, invokes the hosted Aether API, or exposes a shell tool.

Stdout is newline-delimited JSON. Protocol v1 (`aether.exec/1`) remains the default; v2 (`aether.exec/2`) is opt-in with `--exec-protocol 2`. In either version the first frame is `session`, every frame has a monotonically increasing `sequence` and `correlation_id`, and exactly one `terminal` frame ends a session that initialized. Human diagnostics use stderr. Payloads larger than 16 KiB are redacted and written below `.aether/artifacts/<session>/`; the event carries a workspace-relative path, byte count, and SHA-256 digest.

```text
aether exec --test-cmd "npm test" --permission workspace-write \
  --allow-tool read_file --allow-tool repo_search --allow-tool write_file \
  "fix the failing unit test"
```

The default permission is `read-only`, with `read_file` and `repo_search` declared. `workspace-write` permits only declared file writes. Agent-requested shell, test-shell, Git, and network tools are unavailable in both versions and are rejected at argument parsing as well as the execution gate. The operator-supplied `--test-cmd` is a separate final verification gate. Every model tool request produces a `permission_decision` and `tool_receipt`; undeclared tools and permission escalation fail closed.

`--exec-driver selftest` is a packaged deterministic installation check. It proves the installed child process, JSONL transport, and verification gate from outside the source tree; it performs no model work and the initial frame says so. Normal runs use `--exec-driver ollama`.

## Controls

When stdin is a pipe, it accepts one JSON object per line using `aether.exec.control/1`:

```json
{"protocol":"aether.exec.control/1","sequence":0,"correlation_id":"controller-1","action":"steer","note":"only edit tests"}
{"protocol":"aether.exec.control/1","sequence":1,"correlation_id":"controller-1","action":"cancel"}
```

The v1 vocabulary reserves `pause`, `resume`, `steer`, and `cancel`, but only `cancel` is implemented. The other actions return `accepted:false` and are never forwarded or described as applied. Malformed, truncated, duplicate, or out-of-sequence controls terminal-fail the run; later controls are ignored. SIGINT/SIGTERM and timeout terminate the full child process tree and produce one terminal frame.

## Protocol v2 sessions

V2 requires a Git workspace with a committed `HEAD`:

```text
aether exec --exec-protocol 2 --test-cmd "npm test" \
  --authority-ttl-ms 3600000 "fix the failing unit test"
```

Before starting the brain, the host atomically creates an `aether.exec.checkpoint/2` checkpoint under the Aether configuration directory. It binds the canonical workspace and repository, commit, complete working-tree digest, driver/model selection, verification-command digest, permission envelope, optional agent definition, control position, and authority expiry. Checkpoint files are created with restrictive permissions where the platform supports them and are never published as workspace artifacts. A run refreshes the binding after its own accepted mutations. A resume refuses terminal, expired, unreadable, concurrently owned, changed-definition, changed-command, different-commit, or different-workspace checkpoints. Resume authority can only be reused as recorded; model, driver, permission, tools, packs, agent, effort, and TTL cannot be replaced:

```text
aether exec --exec-protocol 2 --resume <session-id> --test-cmd "npm test"
```

V2 controls use `aether.exec.control/2`, and `correlation_id` must equal the session id:

```json
{"protocol":"aether.exec.control/2","sequence":0,"correlation_id":"<session-id>","action":"pause"}
{"protocol":"aether.exec.control/2","sequence":1,"correlation_id":"<session-id>","action":"steer","note":"only edit tests"}
{"protocol":"aether.exec.control/2","sequence":2,"correlation_id":"<session-id>","action":"resume"}
```

Controls are serialized. An identical in-process retry returns the original outcome, a conflicting duplicate is rejected, and a future sequence is rejected without consuming the missing slot. A resumed checkpoint rejects sequences older than its durable control position as stale. Each session accepts at most 256 controls, 16 steer instructions, and 16 KiB of steer text. Pause, resume, and steer are reported as accepted only after the bundled child and its local Ollama brain acknowledge the state change. Cancellation and authority expiry close the brain and tear down its process tree.

Optional agent files use this workspace-confined, versioned shape:

```json
{
  "protocol": "aether.exec.agent/1",
  "version": 1,
  "id": "reviewer",
  "instructions": "Inspect the change and report concrete defects.",
  "allowed_tools": ["read_file", "repo_search"],
  "capability_packs": ["core.read.v1"],
  "permission_ceiling": "read-only",
  "expires_at": "2026-08-24T00:00:00.000Z"
}
```

Load it with `--agent-definition <workspace-relative-path>`. Real-path confinement prevents traversal and symlink escape. Unknown fields, duplicate authority entries, unsupported tools, oversized definitions, expired definitions, and requests above the definition's tool/pack/permission ceiling fail before model execution.

V2 verification records the commit and workspace digest immediately before and after the host-run command. Exit 0 is possible only when the command succeeds and that identity does not change; verification that generates or modifies workspace files is `unattributable` and fails closed.

The currently packaged v2 model driver is local Ollama. The deterministic `selftest` proves child transport and control wiring but performs no model work. A packaged Aether-model acceptance run remains blocked until the production hosted-brain contract guarantees local execution authority (without server-side downgrade) and awaited control acknowledgements; neither selftest nor Ollama is evidence for that hosted path.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Agent completed and authoritative verification passed |
| 1 | Agent or verification failed |
| 2 | Invalid invocation |
| 4 | Agent completed but no verification command was configured |
| 64 | Control protocol violation |
| 77 | V2 authority expired |
| 124 | Timeout |
| 130 | Cancelled |

A model's `done.ok` is advisory. Only the host-run `--test-cmd` verification can produce exit 0.
