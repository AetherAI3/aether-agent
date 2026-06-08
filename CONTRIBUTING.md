# Contributing to Aether Agent

Thanks for helping out. Aether Agent is a small, focused TypeScript client — easy
to read end to end in an afternoon.

## Setup

```bash
git clone https://github.com/DBarr3/aether-agent
cd aether-agent
npm install
npm run build
npm test
```

Node ≥ 20. Zero runtime dependencies — the client uses only Node built-ins, and
that's a feature we'd like to keep. Please don't add a runtime dep without a very
good reason and a maintainer's nod.

## Layout

```
src/
  main.ts          CLI entry + arg parsing + command dispatch
  index.ts         public library API (createClient)
  core/            the universal route — transport, stream, client, auth, ...
  commands/        one file per command (chat, models, login, audit, ...)
test/              node:test unit tests
```

The keystone is `src/core/client.ts` — the one chat route every surface shares.
Most features touch a `core/` module + a `commands/` file.

## Ground rules

- **Tests pass.** `npm test` is green before you open a PR. Add tests for new
  logic (the stream decoder, catalog parsing, and arg resolution are all unit-
  tested — match that bar).
- **Types are honest.** No `any` in application code; narrow `unknown`.
- **Small files, one job each.** If a file grows past ~300 lines it's probably
  doing too much.
- **Comments explain *why*.** The code says what.
- **No secrets, ever.** No tokens, keys, or internal hostnames in code, tests,
  comments, or fixtures. Aether Agent talks to the public Aether API and nothing
  else.

## What makes a great PR

- A clear title and a one-paragraph "why".
- Focused scope — one change per PR.
- Tests for the behavior you added or fixed.
- A note in the PR if you changed the public library API.

## Reporting bugs / ideas

Open an [issue](https://github.com/DBarr3/aether-agent/issues). For security
reports, **do not** open a public issue — see [`SECURITY.md`](SECURITY.md).

By contributing you agree your contributions are licensed under Apache-2.0.
