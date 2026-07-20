// LOOP-01/LOOP-06 round-1 regression: request()'s new bounded-by-default
// timeout (AETHER_REQUEST_TIMEOUT_MS, 30s) must NOT apply to the handful of
// non-streaming calls that block server-side on a completed long-running
// operation (an autonomous test-drive loop, a benchmark pass, or an LLM-
// generated workflow assessment/brainstorm/plan/finalize) rather than
// returning a quick job handle. Each of these opts into stream()'s own
// generous bound (defaultStreamTimeoutMs()) instead — this file proves that
// override actually reaches the fetch call by making the metadata-call
// default too short to survive on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runBenchmark } from "../src/core/bench.js";
import { startTestDrive } from "../src/core/test_drive.js";
import { assessWorkflow, brainstormWorkflow, planWorkflow, finalizeWorkflow, type Workflow } from "../src/core/workflow.js";
import { ApiClient } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";

const ENV_KEY = "AETHER_REQUEST_TIMEOUT_MS";

function setShortRequestTimeout(): () => void {
  const original = process.env[ENV_KEY];
  process.env[ENV_KEY] = "5"; // far shorter than the delayed response below
  return () => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  };
}

/** Resolves successfully, but slower than the shortened metadata-call
 *  default -- only survives if the caller passed a wider override. */
function slowJsonFetch(body: unknown, delayMs = 20): typeof fetch {
  return (async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function mockFetch(fn: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

const WF: Workflow = {
  id: "wf1",
  name: "test workflow",
  createdAt: "",
  updatedAt: "",
  nodes: [],
  edges: [],
  subResourceLinks: [],
};

test("runBenchmark survives a response slower than the metadata-call timeout default", async () => {
  const restoreEnv = setShortRequestTimeout();
  const restoreFetch = mockFetch(
    slowJsonFetch({ bottlenecks: [], optimizations: [], patches: [] }),
  );
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const r = await runBenchmark(api, "neo", "src/x.ts:fn");
    assert.deepEqual(r.patches, []);
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("startTestDrive survives a response slower than the metadata-call timeout default", async () => {
  const restoreEnv = setShortRequestTimeout();
  const restoreFetch = mockFetch(slowJsonFetch({ status: "passed", iterations: 3, patches: [] }));
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    const r = await startTestDrive(api, "neo", "src/x.ts:fn", ".");
    assert.equal(r.status, "passed");
  } finally {
    restoreFetch();
    restoreEnv();
  }
});

test("assessWorkflow / brainstormWorkflow / planWorkflow / finalizeWorkflow each survive a response slower than the metadata-call timeout default", async () => {
  const restoreEnv = setShortRequestTimeout();
  const restoreFetch = mockFetch(slowJsonFetch({ ok: true }));
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore(""));
    await assert.doesNotReject(() => assessWorkflow(api, WF));
    await assert.doesNotReject(() => brainstormWorkflow(api, WF));
    await assert.doesNotReject(() => planWorkflow(api, WF));
    await assert.doesNotReject(() => finalizeWorkflow(api, WF, "# plan"));
  } finally {
    restoreFetch();
    restoreEnv();
  }
});
