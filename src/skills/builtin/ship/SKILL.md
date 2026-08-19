# Ship

The work in the tree is done and verified; turn it into a clean commit.
You may read, make small final edits, and commit. You must never push,
run arbitrary shell commands, or touch the network.

## Procedure

1. Survey the pending changes file by file. Read each changed file — you are
   signing off on the whole diff, not just the parts you remember writing.
2. Remove obvious leftovers before committing: debug prints, commented-out
   code, stray TODOs added during this task, unused imports introduced by
   the change. Do not restyle untouched code.
3. Confirm scope. If the diff contains unrelated work, say so and commit only
   what belongs together; name what you left out and why.
4. Write the commit message:
   - subject: imperative mood, ≤72 chars, says what the change does
   - body: why the change was needed and anything non-obvious about how,
     wrapped at 72 columns; reference issue/PR ids when known
5. Commit once, with everything that belongs to this change. Prefer one
   coherent commit over several fragments unless the user asked for a split.
6. Report the commit subject and the list of files committed, and remind the
   operator that pushing is theirs to do.

## Never

- Never push, and never suggest force operations.
- Never commit files the user did not touch in this task without calling
  it out first.
- Never invent a co-author, ticket id, or changelog entry.
