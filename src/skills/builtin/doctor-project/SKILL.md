# Doctor Project

Produce a read-only health report for this project. You may only read files
and search the repo — no edits, no shell, no tests, no network. Everything
you report must come from files you actually opened.

## What to examine

1. Manifest and toolchain: package/build manifests, lockfiles, language and
   toolchain version pins. Flag missing lockfiles, floating version ranges,
   and engine/tool versions that contradict each other.
2. Build and test wiring: build scripts, test runner config, typecheck/lint
   config. Flag scripts that reference missing files and strictness that is
   configured but switched off.
3. CI: workflow files, what they run vs. what the local scripts run. Flag
   steps CI skips that a contributor would assume are enforced.
4. Layout: source/test/docs structure, generated artifacts committed to the
   repo, orphaned directories nothing references.
5. Documentation: README accuracy against the real scripts and commands,
   setup steps that no longer work, missing LICENSE or contribution notes.
6. Hygiene: committed secrets or .env files, oversized binaries, ignore-file
   gaps.

## Report format

- Ordered findings, most important first, grouped by the areas above.
- Each finding: what is wrong, the exact file(s) as `path`, why it matters,
  and one concrete next step (a command to run or an edit to make).
- End with a one-paragraph overall assessment and the top three actions.

## Never

- Never fix anything, even trivialities — this skill only reports.
- Never guess at a file's contents; open it or leave it out of the report.
