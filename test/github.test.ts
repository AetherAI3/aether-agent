import { test } from "node:test";
import assert from "node:assert/strict";
import { pollUntilConnected, type GithubStatus } from "../src/core/github.js";
import type { ApiClient } from "../src/core/transport.js";

const noSleep = (): Promise<void> => Promise.resolve();

/** Minimal ApiClient stand-in: only getJson is exercised by the poller. */
function fakeApi(statuses: GithubStatus[]): ApiClient {
  let i = 0;
  return {
    async getJson<T>(): Promise<T> {
      const s = statuses[Math.min(i, statuses.length - 1)];
      i += 1;
      return s as unknown as T;
    },
  } as unknown as ApiClient;
}

test("pollUntilConnected returns once status flips connected", async () => {
  const api = fakeApi([{ connected: false }, { connected: true, login: "octocat" }]);
  const s = await pollUntilConnected(api, noSleep, { intervalSec: 0, timeoutSec: 5 });
  assert.equal(s.connected, true);
  assert.equal(s.login, "octocat");
});

test("pollUntilConnected times out when never connected", async () => {
  const api = fakeApi([{ connected: false }]);
  await assert.rejects(
    () => pollUntilConnected(api, noSleep, { intervalSec: 0, timeoutSec: 0 }),
    /timed out/,
  );
});

test("pollUntilConnected swallows transient errors and keeps polling", async () => {
  let calls = 0;
  const api = {
    async getJson<T>(): Promise<T> {
      calls += 1;
      if (calls === 1) throw new Error("502");
      return { connected: true } as unknown as T;
    },
  } as unknown as ApiClient;
  const s = await pollUntilConnected(api, noSleep, { intervalSec: 0, timeoutSec: 5 });
  assert.equal(s.connected, true);
  assert.ok(calls >= 2);
});
