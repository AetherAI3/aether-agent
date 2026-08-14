# Authoring Agent Skills

An Agent Skill is a versioned, digest-bound instruction package. It never
grants authority: the effective tool set is always the intersection of the
operator's session policy, the skill's declarations, and the workspace
boundary. A missing declaration fails closed.

## Layout

```
.aether/skills/project/<name>/     project skill (untrusted until trusted)
  skill.json                       aether.skill/v1 manifest (strict JSON)
  SKILL.md                         instructions (loaded only on invocation)
  references/                      optional resources (must be declared)
  evals/cases.json                 offline eval cases (recommended)
```

User skills live under `<configDir>/skills/user/<name>/` (default
`~/.config/aether/skills/user`). Built-ins ship inside the npm package under
the reserved `aether/*` namespace.

## Manifest rules (aether.skill/v1)

- `schema_version` must be `1`; unknown keys are hard errors.
- `id` is `<scope>/<kebab-name>`; scope must match where the skill lives.
- `version` is strict semver `MAJOR.MINOR.PATCH`.
- `tools.required ⊆ tools.allowed`; `tools.denied ∩ tools.allowed = ∅`;
  only canonical tool names (read_file, write_file, run_shell, run_tests,
  repo_search, git_commit, web_search, web_fetch).
- Permissions come from the closed vocabulary (`workspace.read`,
  `shell.test`, `network.general`, …). `workspace.outside`, `secrets.read`,
  and `billing.spend` cannot be declared by any skill.
- All resource paths are relative, no `..`, no absolute paths, no URLs.
- Resources are loaded ONLY if listed in `context.resources`.

## Digest and trust

One canonical SHA-256 covers the normalized manifest, `SKILL.md`, and every
declared resource/eval file. Trust binds to that digest: change one byte and
the skill returns to `changed · review required`. `aether skills trust <id>`
records trust locally (never in the repo); `aether skills lock` writes the
committed-safe `.aether/skills.lock.json` (digests only, no trust).

## Lifecycle commands

```
aether skills create <name> --scope project|user
aether skills check <id> | --all [--ci]
aether skills eval  <id> | --all [--json] [--junit <path>]
aether skills trust <id>            # inspect digest + permissions, then confirm
aether agent --skill <id> "task"    # explicit invocation
```

Automatic selection requires `triggers.automatic: true` AND (for user/project
skills) an explicit local opt-in — and project skills must be trusted. At most
3 automatic skills load per turn; skill bodies are lazy-loaded only after
selection.

## Evals

`evals/cases.json` is a JSON array of cases:

```json
{ "id": "denies-undeclared-write", "input": "…",
  "expected": { "selected_skill": "project/x", "allowed_tools": ["read_file"],
                 "forbidden_tools": ["write_file"], "max_uvt": 0 } }
```

Offline evals are zero-spend by construction — `max_uvt` must be 0.
