# Zero-UVT Before / After Evidence

## Before class

An HTTP 402 before/during SSE could previously end as blank output, cleared input, lingering animation, or success with no completed turn. No deployed production transcript was captured, so this record does not invent a single production root cause.

## Deterministic after-contract

| Scenario | Proven behavior |
|---|---|
| 402 before body | pulse stops; sanitized top-up/plan action appears; prompt remains retryable; nonzero |
| 402 after deltas | partial text stays visible; terminal outcome has `partial_output:true`; nonzero |
| empty 402 body | stable generic UVT action; never blank |
| JSON/headless | one parseable `aether.turn/1` failed outcome; no human preamble/prompt content |
| local/hosted routing | no silent backend switch |
| EOF or late frame | incomplete/failed once; no success laundering |

Example shape:

```json
{"protocol":"aether.turn/1","type":"turn_outcome","state":"failed","exit_code":1,"retryable":true,"partial_output":false,"prompt_preserved":true}
```

These fixtures prove injected client behavior only. A real zero-balance account, deployed wording, browser/Electron host, and billing ledger remain `UNPROVEN`. Exact-head hosted evidence belongs to the Agent PR/check run.
