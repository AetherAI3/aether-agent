import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  McpOperationCancelledError,
  McpOperationSupervisor,
  McpOperationTimeoutError,
  probeLocalMcpServer,
} from "../src/core/mcp_lifecycle.js";

test("a hanging MCP provider is bounded, aborted, and releases every owned resource", async () => {
  const supervisor = new McpOperationSupervisor();
  let providerSignal: AbortSignal | undefined;
  await assert.rejects(
    supervisor.run(
      "fixture provider",
      async (signal) => {
        providerSignal = signal;
        await new Promise<void>(() => {});
        return "unreachable";
      },
      { timeoutMs: 10 },
    ),
    (error: unknown) => {
      assert.ok(error instanceof McpOperationTimeoutError);
      assert.match(error.message, /request was cancelled/i);
      assert.match(error.message, /safe to retry/i);
      assert.match(error.message, /aether mcp doctor/i);
      return true;
    },
  );
  assert.equal(providerSignal?.aborted, true);
  assert.deepEqual(supervisor.resources(), {
    operations: 0,
    timers: 0,
    cancellationSubscriptions: 0,
  });
});

test("terminal cancellation has one typed outcome and detaches its subscription", async () => {
  const supervisor = new McpOperationSupervisor();
  let cancel: (() => void) | undefined;
  let subscriptions = 0;
  let providerSignal: AbortSignal | undefined;
  const result = supervisor.run(
    "OAuth wait",
    async (signal) => {
      providerSignal = signal;
      await new Promise<void>(() => {});
    },
    {
      timeoutMs: 5_000,
      subscribeCancel(callback) {
        subscriptions++;
        cancel = callback;
        return () => { subscriptions--; };
      },
    },
  );
  await Promise.resolve();
  cancel?.();
  await assert.rejects(result, McpOperationCancelledError);
  assert.equal(providerSignal?.aborted, true);
  assert.equal(subscriptions, 0);
  assert.equal(supervisor.resources().operations, 0);
});

test("100 hanging MCP cycles have zero logical timer/subscription/listener growth", async () => {
  const supervisor = new McpOperationSupervisor();
  const sigintBefore = process.listenerCount("SIGINT");
  let subscriptions = 0;
  for (let index = 0; index < 100; index++) {
    await assert.rejects(
      supervisor.run(
        `cycle ${index}`,
        async () => new Promise<void>(() => {}),
        {
          timeoutMs: 1,
          subscribeCancel() {
            subscriptions++;
            return () => { subscriptions--; };
          },
        },
      ),
      McpOperationTimeoutError,
    );
    assert.deepEqual(supervisor.resources(), {
      operations: 0,
      timers: 0,
      cancellationSubscriptions: 0,
    });
  }
  assert.equal(subscriptions, 0);
  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
});

test("local reachability never sends the stored credential and cancels the response body", async () => {
  let cancelled = 0;
  const result = await probeLocalMcpServer(
    "https://mcp.example.test/sse?opaque=hidden",
    new AbortController().signal,
    async (_url, init) => {
      assert.equal("Authorization" in init.headers, false);
      assert.equal(init.redirect, "manual");
      return {
        status: 401,
        body: { async cancel() { cancelled++; } },
      };
    },
  );
  assert.equal(result.reachable, true);
  assert.equal(result.verified, false);
  assert.equal(result.serviceHealthy, true);
  assert.match(result.detail, /not verified/i);
  assert.equal(cancelled, 1);
});

test("a local HTTP MCP endpoint that never sends headers times out and releases its socket", async () => {
  const server = createServer(() => {
    // Deliberately never send headers: deterministic black-hole fixture.
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const supervisor = new McpOperationSupervisor();
  try {
    await assert.rejects(
      supervisor.run(
        "local black-hole reachability",
        (signal) => probeLocalMcpServer(`http://127.0.0.1:${address.port}/mcp`, signal),
        { timeoutMs: 50 },
      ),
      McpOperationTimeoutError,
    );
    assert.deepEqual(supervisor.resources(), {
      operations: 0,
      timers: 0,
      cancellationSubscriptions: 0,
    });
  } finally {
    supervisor.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("disposing a live MCP supervisor cancels once and rejects future work", async () => {
  const supervisor = new McpOperationSupervisor();
  const live = supervisor.run("live", async () => new Promise<void>(() => {}));
  supervisor.dispose();
  await assert.rejects(live, McpOperationCancelledError);
  await assert.rejects(
    supervisor.run("late", async () => {}),
    McpOperationCancelledError,
  );
  assert.equal(supervisor.resources().operations, 0);
});

test("a defective cancellation disposer cannot strand resources or replace the operation result", async () => {
  const supervisor = new McpOperationSupervisor();
  const result = supervisor.run("defective adapter", async () => 42, {
    subscribeCancel() {
      return () => { throw new Error("broken disposer"); };
    },
  });
  assert.equal(await result, 42);
  assert.deepEqual(supervisor.resources(), {
    operations: 0,
    timers: 0,
    cancellationSubscriptions: 0,
  });
});

test("a cancellation adapter that throws while subscribing leaves no timer or operation", async () => {
  const supervisor = new McpOperationSupervisor();
  await assert.rejects(
    supervisor.run("broken subscription", async () => 42, {
      subscribeCancel() { throw new Error("cannot subscribe"); },
    }),
    /cannot subscribe/,
  );
  assert.deepEqual(supervisor.resources(), {
    operations: 0,
    timers: 0,
    cancellationSubscriptions: 0,
  });
});
