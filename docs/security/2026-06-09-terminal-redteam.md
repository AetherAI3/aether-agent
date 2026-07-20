# Aether Agent Terminal — Red-Team Security Review

**Date:** 2026-06-09
**Scope:** `aether-agent` CLI (TypeScript host). Install/dependency process, the
autonomous agent loop, tool execution, token storage, network transport, and the
GitHub/worktree/repo shell-out paths.
**Method:** Source recon → threat-model each trust boundary → confirm exploitability
→ remediate with tests.

---

## Summary

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| C1 | **CRITICAL** | Permission gate is dead code — agent loop executes every tool call with no prompt | Fixed |
| H1 | **HIGH** | Session token attached to any `baseUrl` scheme/host → cleartext leak / exfil | Fixed |
| M1 | **MEDIUM** | Token file world-readable window (create-then-chmod) + config dir perms | Fixed |
| M2 | **MEDIUM** | `parseRepoSpec` allows `-`/`.`/`..` segments → argument injection into `gh`/`git` | Fixed |
| L1 | LOW | `.gitignore` ignores `.aether-token`; real token file is `.token` (misleading only) | Noted |
| L2 | LOW | Install via `curl|sh` / `irm|iex` with no checksum pinning (accepted convention) | Noted |

**Supply chain (updated 2026-07-20):** clean. `package.json` declares **zero
runtime dependencies**; TypeScript 7 and Node declarations are development-only.
The only lifecycle script builds the package before packing. Installers require
Node 24 and run `npm install -g aether-agents` without privileged build steps.
The current lockfile audit reports zero vulnerabilities.

---

## C1 — Permission gate unenforced in the agent loop (CRITICAL)

**Where:** `src/commands/code.ts` `hostLoop()`; `src/core/autonomy.ts`.

The product documents three permission modes (`src/core/autonomy.ts`):

```
ask  → every edit/shell action prompts the user      (DEFAULT — src/core/config.ts)
auto → actions allowed; prompt only when autoApply off
skip → fully autonomous, no prompts
```

`autonomy.evaluate()` computes whether a tool call `needsPrompt`. **It is never
called.** Grep for callers returns only `autonomy.ts` itself and its unit test.

The real execution path, `hostLoop`, runs every brain-emitted `tool_call`
unconditionally:

```ts
case "tool_call": {
  const result = exec.execute(ev.name, ev.args);  // run_shell / write_file / git_commit
  onToolResult?.(ev.id, result);
  brain.sendToolResult(ev.id, result);
  break;
}
```

`ToolExecutor.run()` uses `spawnSync(command, { shell: true })`. So in the **default
`ask` mode**, which is documented to prompt before every shell/edit action, the
agent silently executes arbitrary shell commands the brain emits, with no prompt
and no way to deny. The `--interactive` flag only pauses at *stage* boundaries
(`stageGate`), not at tool calls, and is off by default.

**Threat model / impact:** the brain's tool stream is the attacker-influenced
channel. Any of the following yields **unattended remote code execution** on the
user's host:
- A poisoned file in the target repo whose contents the cloud brain reflects into
  a `run_shell` (classic prompt-injection of a coding agent).
- A malicious or compromised cloud response (or a MITM — see H1, which makes this
  reachable over cleartext today).
- A buggy/hallucinated `run_shell` (e.g. `rm -rf`) that the user never approved.

The defense-in-depth control exists in the codebase but is unwired, which is worse
than absent because the README/UX imply the user is protected.

**Fix:** wire the gate into `hostLoop`. A pure `decideGate(tool, mode, autoApply,
{yes, isTty})` maps each mutating/shell tool (`write_file`, `run_shell`,
`git_commit`) to `allow | deny | prompt`; read-only tools (`read_file`,
`repo_search`, `run_tests` — the host's own grounding command) are never gated.
In `ask`/`auto`-without-autoApply on a TTY the user gets a `y/N` prompt showing the
command; `--yes` or `skip`/`auto+autoApply` auto-allow. **Non-TTY (CI/pipe) fails
closed** — a mutating/shell call with no way to prompt is *denied* and returned to
the brain as `[denied …]`, so unattended sessions can no longer be driven into RCE
unless the operator explicitly opted in (`--yes`, or `config set permissionMode
skip`). `hostLoop` takes the gate as an injected callback (default allow-all), so
embedded hosts that do their own gating and the existing tests are unaffected.

---

## H1 — Credentials sent to an unvalidated base URL over any scheme (HIGH)

**Where:** `src/core/transport.ts` `ApiClient.authHeaders()`; `src/core/config.ts`.

`baseUrl` comes from `AETHER_BASE_URL` (env) or `config.json`, with **no scheme or
host validation** (`src/core/config.ts`). `ApiClient.authHeaders()` attaches
`Authorization: Bearer <session_token>` to **every** request regardless of scheme:

```ts
private async authHeaders() {
  const t = await this.tokens.get();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
```

So a `baseUrl` of `http://…` sends the long-lived `aek_` session token in
**cleartext**, captureable by any passive on-path observer; and any host value
silently exfiltrates the token to that host on the first authed call. Because the
CLI ships marketing as a secure, signed-custody product, a cleartext token egress
is a meaningful downgrade.

**Fix:** `isCredentialSafeUrl()` — allow `https:` anywhere, allow `http:` only for
loopback (`localhost`/`127.0.0.1`/`::1`) for local-dev backends. `authHeaders()`
**refuses to attach the bearer** (throws a clear error) when the base is insecure
and a token exists. Unauthenticated calls (device-code start) over `http`-loopback
still work; credentials never traverse cleartext to a non-loopback host.

---

## M1 — Token file world-readable window + config dir perms (MEDIUM)

**Where:** `src/core/auth.ts` `FileTokenStore.set()`; dir creation in
`config.ts`/`custody.ts`.

```ts
writeFileSync(this.path, token, "utf8");   // created at umask (often 0644)
chmodSync(this.path, 0o600);               // tightened only AFTER it exists
```

Between the two calls the token file is readable by other local users (TOCTOU
window), and the containing `~/.config/aether` directory is created without an
explicit mode (`mkdirSync(dir, { recursive: true })`), so a `0755` parent allows
traversal to it. On a shared host another user can win the race or read a stale
0644 file.

**Fix:** create the directory `mode: 0o700` and write the file with
`{ mode: 0o600 }` so it is never world-readable even momentarily; keep the
`chmod` as belt-and-suspenders for pre-existing files.

---

## M2 — `parseRepoSpec` permits argument-injection segments (MEDIUM)

**Where:** `src/core/repo.ts` `parseRepoSpec()` → `cloneArgs()` → `spawnSync`.

The owner/name regex `^([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+)$` accepts a leading `-`
and the segments `.` / `..`. `cloneArgs` then passes the value as an argv element
to `gh repo clone <owner/name> <dir>` or `git clone https://…/<owner/name>.git`.
`spawnSync` uses an argv array (no shell), so this is **argument injection, not
command injection** — a value like `-x/y` is handed to `gh` in the repo-positional
slot where a leading dash can be parsed as an option, and `../y` is a surprising
path segment. Bounded impact, but cheap to close.

**Fix:** after the charset match, reject any segment that is `.`/`..` or begins with
`-`.

---

## What was reviewed and found sound

- **Path traversal guard** (`ToolExecutor.safe()`): canonicalizes with
  `realpathSync` on the nearest existing ancestor *before* the allowlist check —
  resists `..`, absolute paths, and symlink escape. Solid.
- **Verification gate** (`verify_gate.ts`): host re-runs the test command itself;
  the brain's self-reported `done.ok` can never upgrade a red tree to `ok`. A
  crashed brain is never `ok`. Good ground-truth design.
- **Session resume** (`session_resume.ts`): replay is render-only
  (`monologueLine`); it does **not** re-execute persisted tool calls, so a tampered
  `events.jsonl` can mislead the transcript but cannot drive execution.
- **GitHub Connect** (`github.ts`): no GitHub token is ever held client-side; only
  the user's own `aek_` token. Backend mints install tokens just-in-time.
- **Worktree/branch naming** (`worktree.ts`): task slugified to `[a-z0-9-]`,
  `spawnSync` argv — no injection.
- **SSE decoding** (`stream.ts`): unknown frame types ignored per contract; malformed
  frames dropped without throwing.

---

## Residual risk / follow-ups

- C1's non-TTY fail-closed default is a behavior change for unattended pipelines
  that previously relied on silent execution; documented in the PR. Operators opt
  back in with `--yes` or `permissionMode: skip`.
- L1: align `.gitignore` (`.aether-token` → `.token`) for clarity. The token lives
  in `~/.config/aether`, outside the repo, so there is no commit risk today.
- Future: move the token to the OS keychain (the `TokenStore` interface already
  abstracts this — see the `auth.ts` TODO).
