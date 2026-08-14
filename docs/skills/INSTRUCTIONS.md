# Instruction files (AGENTS.md and compatibility)

The agent reads these sources, all as bounded, read-only text guidance with
visible provenance — never as executable configuration:

| Source | Scope |
|---|---|
| `.aether/instructions.md` | whole project (canonical, highest file precedence after nested) |
| `AGENTS.md` (root) | whole project |
| `AGENTS.md` (nested) | only files inside its directory subtree |
| `<configDir>/instructions.md` | user-level |
| `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` | compatibility imports |
| `.cursor/rules/*.mdc` | compatibility import, glob-scoped |

Precedence (higher wins): current operator turn > current explicit skill >
nearest nested AGENTS.md > `.aether/instructions.md` > root AGENTS.md >
user-level > compatibility imports. A lower source adds non-conflicting
guidance; it never erases a higher one.

Cursor rules: only the simple glob subset (`*`, `**`, `?`, comma lists) is
supported. Unsupported matching syntax produces a visible warning and the rule
is NOT applied (never silently applied globally).

Conflicts (e.g. two different test commands) are detected and reported with
the effective winner and the reason. Files over 64 KiB are truncated with a
warning; binary/invalid-encoding files are skipped with a reason.

Safety: instruction files cannot run commands, approve URLs, claim
permissions, or import anything outside the project. Their content rides to
the brain as fenced, provenance-labeled data.
