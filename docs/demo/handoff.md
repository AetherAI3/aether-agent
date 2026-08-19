# The handoff demo

> Start a task on one model. Finish it on another, on another machine.
> Your tests decide when it's done.

```bash
npm run demo:handoff
```

This is the reproducible proof behind that sentence, and the script a screen
recording should follow. It runs in about five seconds and needs nothing but a
built checkout — no account, no model download, no network.

## What it does

1. **Machine A.** Builds a throwaway git repo (`slugify`, with an `origin`
   remote) containing two genuinely failing tests, and runs the real CLI over it
   on model A with `--test-cmd`. The session gets half the job done: lowercasing
   and hyphenation land, the whitespace case stays red. The verify gate re-runs
   the tests itself and marks the run `incomplete`; the process exits non-zero.
2. **The handoff.** `aether resume export --out handoff.json` distils the
   session log into one portable file — the task, the model that ran it, the
   verdict, the files that changed, the verification command, and the repository
   identity.
3. **Moving machines.** A second checkout is created at a different absolute
   path, and machine A's checkout **and its session logs are deleted**. Nothing
   the next step does can be quietly reading them, because they no longer exist.
4. **Machine B.** The CLI runs in the second checkout on model B with
   `--resume handoff.json` and **no restated task**. The handoff is the only
   context it is given. It finishes the job.
5. **Proof.** Three independent checks, all of which must hold:
   - the scripted model records session B's first prompt, and it must contain
     the continuation brief naming model A and `src/slug.js`;
   - `node --test` is run directly by the demo script, outside the agent, and
     must be green;
   - the CLI's own verify gate must have exited 0.

Any failure prints `FAILED` with the reasons and exits non-zero, so the script
works as a CI gate as well as a demo.

## What is real and what is stubbed

Real: the `aether` CLI, the git repositories, the file edits, the tool
permission gate, the session log, the handoff file, `node --test`, and the
verify gate.

Stubbed by default: **the model, and only the model**. A local HTTP server
speaks Ollama's OpenAI-compatible chat endpoint with scripted tool calls. That
is what makes the run byte-deterministic — a 4B model asked to fix a bug does
something slightly different every time, which is fine for a product and useless
for a gate.

To run the identical script against real models:

```bash
# needs `ollama serve` and both tags pulled
AETHER_DEMO_REAL=1 npm run demo:handoff

AETHER_DEMO_MODEL_A=qwen2.5-coder:7b \
AETHER_DEMO_MODEL_B=qwen3:4b \
AETHER_DEMO_REAL=1 npm run demo:handoff
```

In real mode the models decide what to do, so the transcript varies and the run
can legitimately fail — that is the honest shape of a small local model on a
real task. The verify gate still has the last word either way.

The demo never touches your real configuration: it points `AETHER_CONFIG_DIR`
and `AETHER_LOG_DIR` at a temporary directory, so your token, config, and
session history are untouched, and everything it created is removed on exit.

## Recording it

The sequence below is the 20–45 second version, readable with the sound off.
Nothing here is staged: every frame is the script's own output.

| Beat | Seconds | On screen |
|---|---|---|
| 1. The task | 0–6 | `aether agent --model <A> "make the slugify tests pass"` — the agent reads, edits, runs the tests |
| 2. Not done | 6–12 | the red verdict line: `✗ incomplete · tests failing` |
| 3. The handoff | 12–18 | `aether resume export --out handoff.json` and the `⇄ handoff written` line |
| 4. Moving | 18–24 | `cd` into the second checkout; `rm -rf` the first one |
| 5. Continue | 24–36 | `aether agent --model <B> --resume handoff.json` — no task typed, the agent picks up where A stopped |
| 6. Done | 36–45 | the green verdict line: `✓ ok · tests green` |

Capture:

```bash
# 1. build, so the run is instant on camera
npm ci && npm run build

# 2. set the terminal to 100x30 and record
asciinema rec handoff.cast -c "npm run demo:handoff"

# 3. or, for a GIF
#    (agg is asciinema's own renderer: https://github.com/asciinema/agg)
agg --font-size 18 --theme dracula handoff.cast handoff.gif
```

`AETHER_NO_ANIM=1` is set inside the demo for the child processes, so the output
is stable text rather than a repainting status line — which is what you want for
a GIF. For a live-feel recording of the product itself, run the two `aether`
commands by hand instead, with animation on.

Do not re-time or re-cut the verdict lines. The whole point of the last beat is
that a test run, not a model, decided it.
