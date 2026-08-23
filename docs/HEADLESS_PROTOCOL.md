# Headless agent protocol

`aether exec [flags] "task"` is the non-interactive, local-only agent surface. The name is deliberately separate from the existing hosted-orchestrator `aether run` and human TUI `aether agent` commands. It starts the packaged local brain child process; it never opens a TTY, invokes the hosted Aether API, or exposes a remote shell.

Stdout is newline-delimited JSON using `protocol: "aether.exec/1"`. The first frame is always `session`, every frame has a monotonically increasing `sequence` and `correlation_id`, and exactly one `terminal` frame ends the stream. Human diagnostics use stderr. Payloads larger than 16 KiB are redacted and written below `.aether/artifacts/<session>/`; the event carries a workspace-relative path, byte count, and SHA-256 digest.

```text
aether exec --test-cmd "npm test" --permission workspace-write \
  --allow-tool read_file --allow-tool repo_search --allow-tool write_file \
  "fix the failing unit test"
```

The default permission is `read-only`, with `read_file` and `repo_search` declared. `workspace-write` permits declared file writes but not shell, git, or network. `shell` permits declared local shell/git tools. Network tools remain disabled in v1. Every requested tool produces a `permission_decision` and `tool_receipt`; undeclared tools and permission escalation fail closed.

## Controls

When stdin is a pipe, it accepts one JSON object per line using `aether.exec.control/1`:

```json
{"protocol":"aether.exec.control/1","sequence":0,"correlation_id":"controller-1","action":"steer","note":"only edit tests"}
{"protocol":"aether.exec.control/1","sequence":1,"correlation_id":"controller-1","action":"cancel"}
```

Actions are `pause`, `resume`, `steer`, and `cancel`. Malformed, truncated, duplicate-sequence, unsupported, or post-cancellation controls receive an explicit rejected `control_result`; protocol violations cancel the run. SIGINT/SIGTERM also cancel the child and produce one terminal frame.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Agent completed and authoritative verification passed |
| 1 | Agent or verification failed |
| 2 | Invalid invocation |
| 4 | Agent completed but no verification command was configured |
| 64 | Control protocol violation |
| 124 | Timeout |
| 130 | Cancelled |

A model's `done.ok` is advisory. Only the host-run `--test-cmd` verification can produce exit 0.
