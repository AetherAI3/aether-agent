# Hosted Windows CI repair

After the loop branch was pushed, GitHub Actions run `29767917285` exposed one
Windows-only failure in `context_registry_scope.test.ts`. The hosted runner's
temporary directory could be represented through an alias whose real path did
not string-match the alias-form pinned file. `confineToWorkspace` compared a
canonical root to that lexical candidate and rejected the valid file as outside
the workspace.

The repair keeps two independent security checks on matching representations:

1. lexical candidate against lexical root, preserving `..` escape rejection;
2. canonical candidate against canonical root, preserving symlink/junction
   escape rejection.

`workspace_scope.test.ts` now covers an aliased workspace root. The original
lexical and link-escape regression remains green. This is a portability repair
required by the new Windows matrix, not a relaxation of the workspace boundary.
