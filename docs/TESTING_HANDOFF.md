# Testing Handoff — AetherCode terminal + local Ollama brain

Goal: pull both repos, run the unit suites, then prove the **full local loop**
(`aether code --local` → Python brain → Ollama → tool calls → tests → checkpoint
→ done). Work top to bottom; each step says what PASS looks like. Report-back
template at the bottom.

Two repos, two roles (see `docs/CONTRACTS.md` / `docs/BRIDGE_PROTOCOL.md`):
- **aether-code** (this repo, TypeScript) — the terminal host: renders + executes tools.
- **Unlimited-Context-LLM** (Python) — `aether_agent` headless brain: decides, emits events.

Baseline tag on both: **`frozen-seam-v1`**.

> **Name clash, read once:** both packages install a console script called
> `aether`. To avoid ambiguity this handoff calls the **TS host** as
> `node <aether-code>/dist/src/main.js` and the **brain** as
> `python -m aether_agent.headless`. Don't rely on a bare `aether` on PATH.

---

## 0. Prerequisites

| Need | Version | Check |
|---|---|---|
| Node | ≥ 20 (tested 22) | `node -v` |
| Python | ≥ 3.10 (tested 3.13) | `python --version` |
| git | any | `git --version` |
| Ollama | latest | `ollama --version` |
| Hardware for 30B | ~24–32 GB RAM or a real GPU (~20–22 GB at Q4_K_M) | — |

If the commits are **not pushed yet**, push from the build machine first:

```bash
# build machine (where the code was written)
cd aether-code            && git push origin main --tags
cd ../Unlimited-Context   && git push origin main --tags
```

Testing on the build machine itself? Skip the clones in Step 1 and `cd` to the
existing dirs.

---

## 1. Pull

```bash
git clone https://github.com/DBarr3/aether-code.git
git clone https://github.com/DBarr3/Unlimited-Context-LLM.git
cd aether-code          && git checkout frozen-seam-v1 && cd ..
cd Unlimited-Context-LLM && git checkout frozen-seam-v1 && cd ..
```

(Or `git checkout main` for the latest, incl. lifecycle + logs.)

---

## 2. Build + unit-test the TS host (no Ollama needed)

```bash
cd aether-code
npm install
npm run build
node --test dist/test/*.test.js
```

**PASS:** `# pass 56  # fail 0`.

> Use the explicit `dist/test/*.test.js` glob. `npm test` uses a directory arg
> (`node --test dist/test/`) that fails on Windows/Node 22 — known, not a defect.

---

## 3. Install + unit-test the Python brain (no Ollama needed)

```bash
cd ../Unlimited-Context-LLM
python -m venv .venv
# activate:  Linux/macOS:  source .venv/bin/activate
#            Windows PS  :  .venv\Scripts\Activate.ps1
pip install -e .
pytest tests/test_bridge.py tests/test_aether_agent.py -q
```

**PASS:** all green (20 in `test_bridge.py`, 5 in `test_aether_agent.py`).
`pip install -e .` pulls numpy + registers the `aether_agent` package and the
`aether` script.

Full engine suite (optional): `pytest -q` (needs numpy; some tests want a model).

---

## 4. Cross-language wire smoke (no Ollama needed)

Proves the Python brain's NDJSON parses in the TS host without a model. From
`Unlimited-Context-LLM` (venv active):

```bash
# Linux/macOS
printf '%s\n' '{"type":"task","text":"hi","pool_gb":5}' \
  | python -m aether_agent.headless 2>/dev/null > /tmp/out.ndjson
node -e 'const{parseEventLine}=require("../aether-code/dist/src/core/brain_protocol.js");
require("fs").readFileSync("/tmp/out.ndjson","utf8").split("\n").filter(Boolean)
.forEach(l=>{const e=parseEventLine(l);console.log(e?("OK "+e.type):("FAIL "+l))})'
```

**PASS:** three lines — `OK stage`, `OK status`, `OK error` (the `error` is the
expected "Cannot reach Ollama" — there's no model yet; the point is the wire
decodes). On Windows PowerShell, drop the output to a repo-local file instead of
`/tmp` (node maps `/tmp` to `C:\tmp`).

---

## 5. Stand up Ollama + the model

```bash
ollama pull qwen3-coder:30b     # ~20 GB download
ollama serve                    # if not already running as a service
ollama list                     # PASS: qwen3-coder:30b is listed
```

Light machine? `qwen3-coder:30b` is the depth build; for ~16 GB use
`qwen3-coder-next` (do NOT use `gemma3` — custom terms), then pass
`--model qwen3-coder-next` in Step 7.

**Make the brain importable by the host.** The TS host spawns `python -m
aether_agent.headless`. If you used a venv, point the host at that interpreter:

```bash
# Linux/macOS
export AETHER_PYTHON="$(pwd)/.venv/bin/python"
# Windows PowerShell
$env:AETHER_PYTHON = "$PWD\.venv\Scripts\python.exe"
```

Sanity: `"$AETHER_PYTHON" -c "import aether_agent; print('ok')"` → `ok`.

---

## 6. Make a tiny broken repo (the test target)

```bash
mkdir agent-target && cd agent-target && git init -q
printf 'def add(a, b):\n    return a - b\n' > calc.py          # BUG: minus
printf 'from calc import add\n\ndef test_add():\n    assert add(2, 3) == 5\n' > test_calc.py
git add -A && git commit -qm "init: failing suite"
pytest -q   # PASS-for-this-step: shows 1 failed (the bug is real)
```

---

## 7. Run the full local loop (THE proof)

From inside `agent-target/`, invoke the TS host (adjust the path to aether-code):

```bash
node /ABS/PATH/TO/aether-code/dist/src/main.js code --local "fix the failing test in calc.py"
#   add --model qwen3-coder-next on light machines
#   add --quiet to strip the personality frames
```

**Watch for, in order:**
- `Aether AI · neo-lite` header,
- `* recon`, then `* execute` stage lines,
- `⌁ skill fix-failing-tests` (the procedure layer fired),
- `: read_file calc.py`, `: write_file calc.py`, `: run_tests …` tool lines,
- a live pool-fill status bar (`local/cache … |████░░| %`),
- `[▪]→[▪▪] checkpoint <sha>` after tests go green,
- a done line ending `[ OKAY ]`,
- `⤷ log: ~/.aether-code/logs/<session-id>`.

**PASS (verify after it exits):**
```bash
cat calc.py                      # return a + b  (fixed)
pytest -q                        # 1 passed
git log --oneline                # an "aether: step N green" checkpoint commit
cat ~/.aether-code/logs/*/manifest.json   # "finalStatus": "ok", toolCalls > 0
```

If `calc.py` is fixed AND `pytest` is green AND a checkpoint commit exists AND
the manifest says `ok` — **the full loop works.**

---

## 8. Stress tool-call emission — THE actual proof (measure degradation, not totals)

Step 7's a−b bug is too easy; a 30B will likely one-shot it. That proves the loop
*executes* — it says nothing about emission holding up. The #1 risk (the local
brain parsing Ollama's tool calls reliably) only shows under length. And the
failure signature is **late degradation**: clean early, garbled deep in. A single
total hides it — you must bucket by session position.

Point it at a repo with **10–50 failing tests** (a real small library at a
known-broken commit; SWE-bench-style is ideal). Let it run unattended:

```bash
node /ABS/PATH/TO/aether-code/dist/src/main.js code --local "fix all failing tests"
```

Then run the triage script over the session log. Save as `triage_log.py`:

```python
import json, sys
events = [json.loads(l) for l in open(sys.argv[1], encoding="utf-8") if l.strip()]

# A model turn starts at each `status reasoning` (top of the brain loop). Attribute
# tool_calls / errors / malformed-args to the turn they occur in.
turns, cur = [], None
def new(): return {"tool_calls": 0, "errors": 0, "wrong_id": 0, "malformed": 0}
for e in events:
    t = e.get("type")
    if t == "status" and e.get("phase") == "reasoning":
        cur = new(); turns.append(cur)
    if cur is None:
        cur = new(); turns.append(cur)
    if t == "tool_call": cur["tool_calls"] += 1
    elif t == "monologue" and str(e.get("text", "")).startswith("malformed-args"): cur["malformed"] += 1
    elif t == "error":
        cur["errors"] += 1
        if "mismatch" in e.get("msg", ""): cur["wrong_id"] += 1

n = len(turns)
chk = sum(1 for e in events if e.get("type") == "checkpoint")
done = [e for e in events if e.get("type") == "done"]
def s(ts, k): return sum(x[k] for x in ts)
def rate(ts): return round(s(ts, "tool_calls") / len(ts), 2) if ts else 0.0
third = max(1, n // 3)
early, late = turns[:third], turns[-third:]

print(f"model turns        : {n}")
print(f"tool_calls         : {s(turns,'tool_calls')}")
print(f"errors             : {s(turns,'errors')}  (wrong_id {s(turns,'wrong_id')}, adapter/other {s(turns,'errors')-s(turns,'wrong_id')})")
print(f"malformed-args      : {s(turns,'malformed')}")
print(f"checkpoints         : {chk}")
print(f"EARLY third  turns={len(early)} tool_calls={s(early,'tool_calls')} errors={s(early,'errors')} malformed={s(early,'malformed')} emission_rate={rate(early)}")
print(f"LATE  third  turns={len(late)}  tool_calls={s(late,'tool_calls')} errors={s(late,'errors')} malformed={s(late,'malformed')} emission_rate={rate(late)}")
finish = "done(ok)" if done and done[-1].get("ok") else ("done(fail)" if done else "NO done — STALLED/LOOPED")
print(f"finish             : {finish}   (premature if checkpoints==0 and finish==done(ok) = no-call-just-prose)")
```

```bash
python triage_log.py ~/.aether-code/logs/<id>/events.jsonl
```

**Read it like this:**
- `emission_rate` = tool_calls per model turn. **LATE rate << EARLY rate = degradation** (the real failure signature).
- `malformed-args` rising in the late third = the model fraying its JSON tool calls deep in the run.
- `wrong_id` > 0 = a correlation break (should be 0 — the host replies in order).
- `finish = STALLED/LOOPED`, or `done(ok)` with `checkpoints == 0` = **no-call-just-prose** (model talked instead of acting; never grounded on green).

**Regression check** (previously-passing tests re-broken): before the run,
`pytest -q | tail -1` to record the passing count on a clean checkout; after,
re-run and confirm no test that passed before now fails. The agent should only
turn red→green, never green→red.

Mitigation if it degrades: `--model qwen3-coder-next`, or shorter task. Report the
numbers either way — degradation IS the finding.

---

## 9. Interactive + logs (optional)

```bash
node /ABS/PATH/TO/aether-code/dist/src/main.js code --local --interactive "fix the test"
# pauses at each stage; press Enter to continue, or type a steer note
node /ABS/PATH/TO/aether-code/dist/src/main.js code --local --no-log "…"   # disable the log
```

---

## NOT in scope yet (don't expect these)

- **ON-vs-OFF kill-gate** (`bench/drift_vs_window.py`) — the honest promote gate
  (Unlimited Context ON vs naive truncation OFF on a ~200-failing suite). Harness
  not built; this handoff proves the loop runs, not that the context engine wins.
- **Cloud brain tool round-trip** — `aether code` without `--local` streams the
  server brain, which runs tools server-side; it won't drive local file edits
  until the server emits `tool_call` frames (known gap, host unchanged when it lands).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Cannot reach Ollama at http://localhost:11434` | `ollama serve` not running |
| `model 'qwen3-coder:30b' … pull` | `ollama pull qwen3-coder:30b` |
| Host hangs after the task, no events | `AETHER_PYTHON` wrong, or `aether_agent` not importable by it — re-run the Step 5 sanity import |
| `refusing path outside workspace` | working as designed — run from inside the target repo, paths stay in cwd |
| Garbled kaomoji in a Windows console | cosmetic only; the wire is ASCII-safe, the loop is unaffected |
| `node --test dist/test/` finds nothing | use the `dist/test/*.test.js` glob (Step 2 note) |
| Two `aether` commands collide on PATH | use `node dist/src/main.js` (host) and `python -m aether_agent.headless` (brain) |

---

## Report back — fill this in

These are the exact fields triaged from. The step-8 block is the important one.

```
CONFIG
  model ____   box: OS ____  CPU/GPU ____  RAM ____   ollama ____  node ____  python ____

UNIT (sanity)
  Step 2 TS:   PASS / FAIL  (__ / 56)
  Step 3 Py:   PASS / FAIL
  Step 4 wire: PASS / FAIL

STEP 7 — loop executes (4-point check)
  file fixed (calc.py = a + b)?   Y / N
  pytest green?                   Y / N
  checkpoint commit present?      Y / N
  manifest finalStatus = ok?      Y / N
  done line: ____

STEP 8 — emission under length (from triage_log.py)
  total model turns:        ____
  tool_call count:          ____
  error count:              ____  → malformed-JSON ____  · wrong-id ____  · no-call-just-prose ____
  emission rate EARLY third: ____   LATE third: ____      (late << early = degradation)
  completed unattended / stalled / looped:   ____
  regression (any previously-passing test re-broken)?   Y / N  (count: ____)
  anything qualitatively weird in monologue.txt:  ____

  session log path: ____
```

The `error count` split maps to the log like this:
- **malformed-JSON** = `malformed-args` markers (triage script).
- **wrong-id** = `error` whose msg contains "mismatch" (`wrong_id` in the script).
- **no-call-just-prose** = `finish` is `STALLED/LOOPED`, or `done(ok)` with `checkpoints == 0`.

Paste that back and I'll triage from the numbers.
