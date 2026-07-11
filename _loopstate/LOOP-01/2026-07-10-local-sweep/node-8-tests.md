# LOOP-01 node 8 - verification

## Focused verification

`npm run build; node --test --test-isolation=none dist/test/mcp_core.test.js dist/test/mcp_command.test.js dist/test/slash.test.js`

- 22 passed
- 0 failed
- 0 cancelled

## Full verification

`npm test`

- 654 tests total
- 645 passed
- 0 failed
- 9 skipped by the sandbox (child-process tests)
- Build passed

The new regression test fails against the old behavior because the malformed list is used as an iterable; it passes after the response-boundary validation and `/mcp` degrades to its offline menu.
