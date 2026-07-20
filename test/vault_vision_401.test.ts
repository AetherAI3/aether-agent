// Regression tests for LOOP-01: vault.ts's downloadFile/uploadFile/
// deleteSpacesFile and vision.ts's downloadMediaFile used to bypass ApiClient
// entirely via raw fetch() + private-member casts (`_bearerToken`/`_baseUrl`/
// `_authHeaders` in vault.ts, a local `authHeaders()` cast in vision.ts). That
// meant none of them got PR #47's refresh-on-401 retry, and because they threw
// plain `Error` (not `HttpError`) instead of ApiClient.request()'s
// toHttpError(), errorHint()/hintFor() could never classify their failures
// into a 401/402/403 hint either.
//
// These four functions now route through ApiClient's public getBinary()/
// postForm()/deleteJson() — same fetch-stubbing pattern as test/auth_401.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApiClient, VAULT_SPACES_DOWNLOAD_PATH, VAULT_SPACES_DELETE_PATH, VAULT_SPACES_UPLOAD_PATH } from "../src/core/transport.js";
import { StaticTokenStore } from "../src/core/auth.js";
import { HttpError } from "../src/core/errors.js";
import { hintFor } from "../src/core/error_hints.js";
import { uploadFile, downloadFile, deleteSpacesFile } from "../src/core/vault.js";
import { downloadMediaFile } from "../src/core/vision.js";

type Call = { url: string; init: RequestInit };

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response, calls: Call[]): void {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    return handler(u, init ?? {});
  }) as typeof globalThis.fetch;
}

function bearer(init: RequestInit): string {
  return (init.headers as Record<string, string>)["Authorization"] ?? "";
}

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "aether-vault-vision-401-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

// ── uploadFile ────────────────────────────────────────────────────────────

test("uploadFile: 401 with a session token triggers one /auth/refresh then a retry that succeeds", () =>
  withTempDir(async (dir) => {
    const real = globalThis.fetch;
    const calls: Call[] = [];
    const filePath = join(dir, "hello.txt");
    writeFileSync(filePath, "upload me");
    const store = new StaticTokenStore("sess_expired");
    stubFetch((url, init) => {
      if (url.endsWith("/auth/refresh")) return jsonRes(200, { session_token: "sess_fresh" });
      if (bearer(init) === "Bearer sess_fresh") {
        assert.ok(init.body instanceof FormData, "upload body must be multipart FormData");
        return jsonRes(200, { key: "k1", filename: "hello.txt", size: 9, content_type: "text/plain" });
      }
      return jsonRes(401, { detail: "token expired" });
    }, calls);
    try {
      const api = new ApiClient("https://api.example", store);
      const out = await uploadFile(api, filePath);
      assert.deepEqual(out, { key: "k1", filename: "hello.txt", size: 9, content_type: "text/plain" });
      const urls = calls.map((c) => c.url.replace("https://api.example", ""));
      assert.deepEqual(urls, [VAULT_SPACES_UPLOAD_PATH, "/auth/refresh", VAULT_SPACES_UPLOAD_PATH]);
    } finally {
      globalThis.fetch = real;
    }
  }));

// ── downloadFile ──────────────────────────────────────────────────────────

test("downloadFile: 401 triggers refresh + retry, and streams the body to disk", () =>
  withTempDir(async (dir) => {
    const real = globalThis.fetch;
    const calls: Call[] = [];
    const store = new StaticTokenStore("sess_expired");
    const outputPath = join(dir, "out.bin");
    stubFetch((url, init) => {
      if (url.endsWith("/auth/refresh")) return jsonRes(200, { session_token: "sess_fresh" });
      if (bearer(init) === "Bearer sess_fresh") return new Response("binary-content-xyz");
      return jsonRes(401, {});
    }, calls);
    try {
      const api = new ApiClient("https://api.example", store);
      const saved = await downloadFile(api, "myfile.bin", outputPath);
      assert.equal(saved, outputPath);
      assert.equal(readFileSync(outputPath, "utf-8"), "binary-content-xyz");
      const path = VAULT_SPACES_DOWNLOAD_PATH + "/myfile.bin";
      const urls = calls.map((c) => c.url.replace("https://api.example", ""));
      assert.deepEqual(urls, [path, "/auth/refresh", path]);
    } finally {
      globalThis.fetch = real;
    }
  }));

// ── deleteSpacesFile ──────────────────────────────────────────────────────

test("deleteSpacesFile: 401 triggers refresh + retry that succeeds", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  const store = new StaticTokenStore("sess_expired");
  stubFetch((url, init) => {
    if (url.endsWith("/auth/refresh")) return jsonRes(200, { session_token: "sess_fresh" });
    if (bearer(init) === "Bearer sess_fresh") {
      assert.equal(init.method, "DELETE");
      return jsonRes(200, { success: true, deleted: "myfile.bin" });
    }
    return jsonRes(401, {});
  }, calls);
  try {
    const api = new ApiClient("https://api.example", store);
    const out = await deleteSpacesFile(api, "myfile.bin");
    assert.deepEqual(out, { success: true, deleted: "myfile.bin" });
    const path = VAULT_SPACES_DELETE_PATH + "/myfile.bin";
    const urls = calls.map((c) => c.url.replace("https://api.example", ""));
    assert.deepEqual(urls, [path, "/auth/refresh", path]);
  } finally {
    globalThis.fetch = real;
  }
});

test("deleteSpacesFile: a non-retryable 401 (aek_ key) surfaces as HttpError, and hintFor gives the auth-login hint", async () => {
  const real = globalThis.fetch;
  stubFetch(() => jsonRes(401, { detail: "expired" }), []);
  try {
    const api = new ApiClient("https://api.example", new StaticTokenStore("aek_key"));
    let caught: unknown;
    await assert.rejects(
      () => deleteSpacesFile(api, "myfile.bin"),
      (e: unknown) => {
        caught = e;
        return e instanceof HttpError && e.status === 401;
      },
    );
    assert.match(hintFor(caught) ?? "", /aether auth login/);
  } finally {
    globalThis.fetch = real;
  }
});

// ── downloadMediaFile ─────────────────────────────────────────────────────

test("downloadMediaFile: 401 triggers refresh + retry, and streams the body to disk (media host is the SAME origin as the API)", () =>
  withTempDir(async (dir) => {
    const real = globalThis.fetch;
    const calls: Call[] = [];
    const store = new StaticTokenStore("sess_expired");
    // Same origin as the ApiClient's baseUrl ("https://api.example") so the
    // bearer is attached and the refresh-on-401 retry applies — the
    // cross-origin case (no bearer attached at all, no refresh) is covered
    // separately below and in test/transport_getbinary.test.ts.
    const mediaUrl = "https://api.example/output/abc.png";
    stubFetch((url, init) => {
      if (url.endsWith("/auth/refresh")) return jsonRes(200, { session_token: "sess_fresh" });
      if (url === mediaUrl && bearer(init) === "Bearer sess_fresh") return new Response("PNGDATA");
      return jsonRes(401, {});
    }, calls);
    try {
      const api = new ApiClient("https://api.example", store);
      const savedPath = await downloadMediaFile(api, mediaUrl, dir, "vision_nano_pro", "image", "myimage.png");
      assert.equal(savedPath, join(dir, "myimage.png"));
      assert.equal(readFileSync(savedPath, "utf-8"), "PNGDATA");
      const urls = calls.map((c) => c.url.replace("https://api.example", ""));
      assert.deepEqual(urls, [mediaUrl.replace("https://api.example", ""), "/auth/refresh", mediaUrl.replace("https://api.example", "")]);
    } finally {
      globalThis.fetch = real;
    }
  }));

// LOOP-01 round 2 (HIGH): isCredentialSafeUrl() only checked scheme, so a
// cross-origin (or even a same-scheme-but-different-host) media_url used to
// get the live session bearer attached anyway. It's now gated on
// same-origin-as-baseUrl instead, and a cross-origin target is fetched
// UNAUTHENTICATED rather than failing the whole download closed.
test("downloadMediaFile: does NOT attach the bearer to a cross-origin https media host, and still succeeds unauthenticated", () =>
  withTempDir(async (dir) => {
    const real = globalThis.fetch;
    const calls: Call[] = [];
    const mediaUrl = "https://media.example/output/abc.png"; // different host than https://api.example
    stubFetch((url, init) => {
      assert.equal(bearer(init), "", "no Authorization header should be sent to a cross-origin host");
      return url === mediaUrl ? new Response("PNGDATA") : jsonRes(404, {});
    }, calls);
    try {
      const api = new ApiClient("https://api.example", new StaticTokenStore("aek_live_session_token"));
      const savedPath = await downloadMediaFile(api, mediaUrl, dir, "vision_nano_pro", "image", "myimage.png");
      assert.equal(readFileSync(savedPath, "utf-8"), "PNGDATA");
      assert.equal(calls.length, 1, "no refresh attempted — no token was ever sent, so a 401 can't occur here");
    } finally {
      globalThis.fetch = real;
    }
  }));

test("downloadMediaFile: a cross-origin media host is fetched unauthenticated even over PLAIN http (non-loopback) — no InsecureTransportError, no credential sent", () =>
  withTempDir(async (dir) => {
    const real = globalThis.fetch;
    const calls: Call[] = [];
    stubFetch((_url, init) => {
      assert.equal(bearer(init), "", "no Authorization header should ever reach a foreign http host");
      return new Response("PNGDATA");
    }, calls);
    try {
      const api = new ApiClient("https://api.example", new StaticTokenStore("aek_test"));
      const savedPath = await downloadMediaFile(api, "http://evil.example.com/media.png", dir, "vision_nano_pro", "image", "m.png");
      assert.equal(readFileSync(savedPath, "utf-8"), "PNGDATA");
      assert.equal(calls.length, 1);
    } finally {
      globalThis.fetch = real;
    }
  }));

test("downloadMediaFile: SAME-origin download still fails closed when the API's own baseUrl itself is an insecure (non-loopback http) transport", async () => {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  stubFetch(() => { throw new Error("must not fetch — should fail closed before any network call"); }, calls);
  try {
    const api = new ApiClient("http://not-localhost.example", new StaticTokenStore("aek_test"));
    await assert.rejects(
      () => downloadMediaFile(api, "http://not-localhost.example/media.png", "/tmp", "vision_nano_pro", "image"),
      /insecure transport/,
    );
    assert.equal(calls.length, 0, "no fetch attempted once the guard fires");
  } finally {
    globalThis.fetch = real;
  }
});
