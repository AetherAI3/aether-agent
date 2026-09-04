import assert from "node:assert/strict";
import { test } from "node:test";

import { StaticTokenStore } from "../src/core/auth.js";
import { HttpError } from "../src/core/errors.js";
import { ApiClient } from "../src/core/transport.js";
import {
  CloudVoiceTransport,
  MAX_VOICE_HINT_CHARS,
  serializeVoiceHints,
  VoiceProtocolError,
} from "../src/core/voice_transport.js";

function mockFetch(fn: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return () => {
    globalThis.fetch = original;
  };
}

function cancellableAudioResponse(headers: HeadersInit): {
  response: Response;
  wasCancelled: () => boolean;
} {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([9, 8, 7]));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, { headers }),
    wasCancelled: () => cancelled,
  };
}

test("voice hint serialization is deduplicated and bounded to Cloud's wire contract", () => {
  const hints = serializeVoiceHints({
    surface: "code",
    situation: "Editing the terminal voice adapter ".repeat(20),
    terms: ["Aether", "aether", ...Array.from({ length: 80 }, (_, i) => `symbol${i}`)],
  });
  assert.ok(hints.length <= MAX_VOICE_HINT_CHARS);
  assert.equal((hints.match(/Aether/giu) ?? []).length, 1);
  assert.ok(hints.includes("Likely vocabulary:"));
});

test("Cloud Voice transport sends the exact multipart STT contract and returns editable text", async () => {
  let captured: RequestInit | undefined;
  const restore = mockFetch((async (_url: unknown, init?: RequestInit) => {
    captured = init;
    return Response.json({ text: "open the lifecycle reducer" });
  }) as typeof fetch);
  try {
    const transport = new CloudVoiceTransport(
      new ApiClient("https://api.example", new StaticTokenStore("session-token")),
    );
    const text = await transport.transcribe(
      { bytes: new Uint8Array([1, 2, 3]), mime: "audio/webm", durationSeconds: 1.25, filename: "clip.webm" },
      {
        signal: new AbortController().signal,
        hints: { surface: "code", terms: ["Aether", "turn_lifecycle"] },
      },
    );
    assert.equal(text, "open the lifecycle reducer");
    assert.equal(captured?.method, "POST");
    assert.equal((captured?.headers as Record<string, string> | undefined)?.["Authorization"], "Bearer session-token");
    const form = captured?.body as FormData;
    assert.ok(form.get("audio") instanceof Blob);
    assert.equal(form.get("duration_s"), "1.25");
    assert.match(String(form.get("hints")), /turn_lifecycle/);
  } finally {
    restore();
  }
});

test("Cloud Voice transport rejects empty capture before making a billable request", async () => {
  let calls = 0;
  const restore = mockFetch((async () => {
    calls++;
    return Response.json({ text: "impossible" });
  }) as typeof fetch);
  try {
    const transport = new CloudVoiceTransport(new ApiClient("https://api.example", new StaticTokenStore("token")));
    await assert.rejects(
      () =>
        transport.transcribe(
          { bytes: new Uint8Array(), mime: "audio/webm", durationSeconds: 1 },
          { signal: new AbortController().signal },
        ),
      VoiceProtocolError,
    );
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test("Cloud Voice transport preserves server-side TTS ownership and provenance", async () => {
  let requestBody: unknown;
  const restore = mockFetch((async (_url: unknown, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(new Uint8Array([9, 8, 7]), {
      headers: {
        "Content-Type": "audio/mpeg",
        "X-Aether-Voice-Model": "cloud-router-1",
        "Cache-Control": "private, No-Store",
      },
    });
  }) as typeof fetch);
  try {
    const transport = new CloudVoiceTransport(new ApiClient("https://api.example", new StaticTokenStore("token")));
    const result = await transport.synthesize(" answer aloud ", {
      signal: new AbortController().signal,
      voice: "warm",
      purpose: "conversation",
    });
    assert.deepEqual(requestBody, { text: "answer aloud", voice: "warm", purpose: "conversation" });
    assert.equal(result.mime, "audio/mpeg");
    assert.equal(result.model, "cloud-router-1");
    assert.deepEqual([...result.bytes], [9, 8, 7]);
  } finally {
    restore();
  }
});

test("Cloud Voice transport rejects missing model provenance and cancels the audio body", async () => {
  const streamed = cancellableAudioResponse({
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-store",
  });
  const restore = mockFetch((async () => streamed.response) as typeof fetch);
  try {
    const transport = new CloudVoiceTransport(new ApiClient("https://api.example", new StaticTokenStore("token")));
    await assert.rejects(
      () =>
        transport.synthesize("hello", {
          signal: new AbortController().signal,
          voice: "auto",
          purpose: "chat",
        }),
      (error: unknown) => error instanceof VoiceProtocolError && /model provenance/i.test(error.message),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(streamed.wasCancelled(), true);
  } finally {
    restore();
  }
});

test("Cloud Voice transport rejects missing or incorrect no-store policy and cancels each body", async (t) => {
  for (const cacheControl of [undefined, "private, max-age=0", "x-no-store"] as const) {
    await t.test(cacheControl ?? "missing Cache-Control", async () => {
      const streamed = cancellableAudioResponse({
        "Content-Type": "audio/mpeg",
        "X-Aether-Voice-Model": "cloud-router-1",
        ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
      });
      const restore = mockFetch((async () => streamed.response) as typeof fetch);
      try {
        const transport = new CloudVoiceTransport(
          new ApiClient("https://api.example", new StaticTokenStore("token")),
        );
        await assert.rejects(
          () =>
            transport.synthesize("hello", {
              signal: new AbortController().signal,
              voice: "auto",
              purpose: "chat",
            }),
          (error: unknown) => error instanceof VoiceProtocolError && /no-store/i.test(error.message),
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(streamed.wasCancelled(), true);
      } finally {
        restore();
      }
    });
  }
});

test("TTS 402 remains a typed gate so optional audio can degrade without failing text", async () => {
  const restore = mockFetch((async () => Response.json({ error: "insufficient UVT" }, { status: 402 })) as typeof fetch);
  try {
    const transport = new CloudVoiceTransport(new ApiClient("https://api.example", new StaticTokenStore("token")));
    await assert.rejects(
      () =>
        transport.synthesize("visible text remains", {
          signal: new AbortController().signal,
          voice: "auto",
          purpose: "chat",
        }),
      (error: unknown) => error instanceof HttpError && error.status === 402,
    );
  } finally {
    restore();
  }
});

test("a successful non-audio response is rejected as a contract violation", async () => {
  const restore = mockFetch((async () => Response.json({ unexpected: true })) as typeof fetch);
  try {
    const transport = new CloudVoiceTransport(new ApiClient("https://api.example", new StaticTokenStore("token")));
    await assert.rejects(
      () =>
        transport.synthesize("hello", {
          signal: new AbortController().signal,
          voice: "auto",
          purpose: "chat",
        }),
      VoiceProtocolError,
    );
  } finally {
    restore();
  }
});
