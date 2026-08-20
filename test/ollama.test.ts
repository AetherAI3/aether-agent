import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  ollamaChat,
  extractToolCalls,
  samplingFor,
  normalizeOllamaHost,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  type ChatMessage,
  type ToolSchema,
} from "../src/core/ollama.js";

// Spin up a one-shot OpenAI-compat stub on 127.0.0.1 and return its base url.
function stub(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void,
): Promise<{ base: string; server: Server; lastBody: () => string }> {
  let lastBody = "";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastBody = body;
      handler(req, body, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ base: `http://127.0.0.1:${port}`, server, lastBody: () => lastBody });
    });
  });
}

// --- samplingFor: per-model profile (port of profiles.py spirit) ------------
test("samplingFor gives coder models a low deterministic temperature", () => {
  const s = samplingFor("qwen2.5-coder:7b");
  assert.ok(s.temperature <= 0.3, "coder default is low-temp");
});

test("samplingFor gives gemma Google sampling (high temp / top_k 64)", () => {
  const s = samplingFor("gemma3:4b");
  assert.equal(s.temperature, 1.0);
  assert.equal(s.top_k, 64);
});

test("samplingFor falls back to a safe deterministic default for unknown tags", () => {
  const s = samplingFor("some-unknown-model:13b");
  assert.ok(s.temperature <= 0.3, "unknown tag -> safe deterministic default");
});

// --- extractToolCalls: recover a call emitted as JSON text in content -------
test("extractToolCalls recovers a <tool_call> wrapped call", () => {
  const content = 'Sure.\n<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>';
  const calls = extractToolCalls(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.function.name, "read_file");
  assert.deepEqual(JSON.parse(calls[0]?.function.arguments ?? "{}"), { path: "a.ts" });
});

test("extractToolCalls recovers a fenced ```json call", () => {
  const content = "Here you go:\n```json\n{\"name\":\"write_file\",\"arguments\":{\"path\":\"b.ts\",\"content\":\"x\"}}\n```";
  const calls = extractToolCalls(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.function.name, "write_file");
});

test("extractToolCalls recovers a bare balanced object and dedupes", () => {
  const content =
    'thinking... {"name":"run_tests","parameters":{"command":"npm test"}} ' +
    'and again {"name":"run_tests","parameters":{"command":"npm test"}}';
  const calls = extractToolCalls(content);
  assert.equal(calls.length, 1, "identical (name,args) deduped");
  assert.equal(calls[0]?.function.name, "run_tests");
  assert.deepEqual(JSON.parse(calls[0]?.function.arguments ?? "{}"), { command: "npm test" });
});

test("extractToolCalls returns [] for plain prose / empty", () => {
  assert.deepEqual(extractToolCalls("just a normal answer, no tools"), []);
  assert.deepEqual(extractToolCalls(""), []);
  assert.deepEqual(extractToolCalls(null), []);
});

test("extractToolCalls assigns stable call-N ids", () => {
  const content =
    '{"name":"read_file","arguments":{"path":"a"}} then {"name":"read_file","arguments":{"path":"b"}}';
  const calls = extractToolCalls(content);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.id, "call-1");
  assert.equal(calls[1]?.id, "call-2");
});

// --- ollamaChat: request body shape -----------------------------------------
test("ollamaChat posts the OpenAI-compat body with stream:false + sampling", async () => {
  const { base, server, lastBody } = await stub((_req, _body, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }));
  });
  try {
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    const reply = await ollamaChat(messages, { host: base, model: "qwen2.5-coder:7b" });
    const sent = JSON.parse(lastBody());
    assert.equal(sent.model, "qwen2.5-coder:7b");
    assert.equal(sent.stream, false);
    assert.deepEqual(sent.messages, messages);
    assert.ok(sent.temperature <= 0.3, "coder sampling applied");
    assert.equal(reply.role, "assistant");
    assert.equal(reply.content, "hi");
  } finally {
    server.close();
  }
});

test("ollamaChat forwards tools and a chosen temperature override", async () => {
  const { base, server, lastBody } = await stub((_req, _body, res) => {
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }));
  });
  try {
    const tools: ToolSchema[] = [
      { type: "function", function: { name: "read_file", parameters: {} } },
    ];
    await ollamaChat([{ role: "user", content: "go" }], {
      host: base,
      model: "qwen2.5-coder:7b",
      tools,
      temperature: 0.7,
    });
    const sent = JSON.parse(lastBody());
    assert.deepEqual(sent.tools, tools);
    assert.equal(sent.temperature, 0.7, "explicit temperature wins over the profile");
  } finally {
    server.close();
  }
});

// --- ollamaChat: tool-call RECOVERY from content when structured field absent -
test("ollamaChat recovers tool_calls emitted as JSON text in content", async () => {
  const { base, server } = await stub((_req, _body, res) => {
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: '<tool_call>{"name":"read_file","arguments":{"path":"x.ts"}}</tool_call>',
            },
          },
        ],
      }),
    );
  });
  try {
    const reply = await ollamaChat([{ role: "user", content: "read x" }], { host: base });
    assert.ok(reply.tool_calls && reply.tool_calls.length === 1, "recovered from content");
    assert.equal(reply.tool_calls?.[0]?.function.name, "read_file");
  } finally {
    server.close();
  }
});

test("ollamaChat prefers the structured tool_calls field when present", async () => {
  const { base, server } = await stub((_req, _body, res) => {
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                { id: "abc", type: "function", function: { name: "run_tests", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    );
  });
  try {
    const reply = await ollamaChat([{ role: "user", content: "test" }], { host: base });
    assert.equal(reply.tool_calls?.length, 1);
    assert.equal(reply.tool_calls?.[0]?.id, "abc");
  } finally {
    server.close();
  }
});

// --- ollamaChat: clear error hints (down / model not pulled) -----------------
test("ollamaChat throws a clear hint when Ollama is unreachable", async () => {
  // Port 1 on loopback is not listening -> ECONNREFUSED.
  await assert.rejects(
    () => ollamaChat([{ role: "user", content: "x" }], { host: "http://127.0.0.1:1" }),
    /ollama|11434|not running|unreachable|ollama serve/i,
  );
});

test("ollamaChat throws a model-not-pulled hint on a 404", async () => {
  const { base, server } = await stub((_req, _body, res) => {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "model 'qwen2.5-coder:7b' not found, try pulling it first" }));
  });
  try {
    await assert.rejects(
      () => ollamaChat([{ role: "user", content: "x" }], { host: base, model: "qwen2.5-coder:7b" }),
      /pull|not found|ollama pull/i,
    );
  } finally {
    server.close();
  }
});

test("DEFAULT_OLLAMA_MODEL is the universal small coder default", () => {
  assert.equal(DEFAULT_OLLAMA_MODEL, "qwen2.5-coder:7b");
});

// --- normalizeOllamaHost: Ollama's own scheme-less OLLAMA_HOST convention ----
test("normalizeOllamaHost accepts the scheme-less host:port ollama serve prints", () => {
  assert.equal(normalizeOllamaHost("127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaHost("localhost:11434"), "http://localhost:11434");
});

test("normalizeOllamaHost maps the 0.0.0.0 bind address to a connectable one", () => {
  assert.equal(normalizeOllamaHost("0.0.0.0:11434"), "http://127.0.0.1:11434");
  assert.equal(normalizeOllamaHost("http://0.0.0.0:11434"), "http://127.0.0.1:11434");
});

test("normalizeOllamaHost keeps explicit schemes and strips trailing slashes", () => {
  assert.equal(normalizeOllamaHost("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(normalizeOllamaHost("http://localhost:11434///"), "http://localhost:11434");
  assert.equal(normalizeOllamaHost("https://ollama.example.com"), "https://ollama.example.com");
  assert.equal(normalizeOllamaHost("https://ollama.example.com/proxy/"), "https://ollama.example.com/proxy");
});

test("normalizeOllamaHost falls back to the default for empty/whitespace/undefined", () => {
  assert.equal(normalizeOllamaHost(undefined), DEFAULT_OLLAMA_HOST);
  assert.equal(normalizeOllamaHost(""), DEFAULT_OLLAMA_HOST);
  assert.equal(normalizeOllamaHost("   "), DEFAULT_OLLAMA_HOST);
  assert.equal(normalizeOllamaHost("  127.0.0.1:11434  "), "http://127.0.0.1:11434");
});

test("normalizeOllamaHost rejects unusable values and names the bad value", () => {
  assert.throws(() => normalizeOllamaHost("ftp://localhost:11434"), /ftp/);
  assert.throws(() => normalizeOllamaHost("http://"), /"http:\/\/"|no hostname|Invalid Ollama host/);
  assert.throws(() => normalizeOllamaHost(":::"), /Invalid Ollama host/);
});

// The bug this fixes: a scheme-less host was concatenated raw, so fetch() got
// "127.0.0.1:11434/v1/chat/completions" -> "Failed to parse URL", which the
// unreachable-handler then reported as "set OLLAMA_HOST" — the thing the user did.
test("ollamaChat completes a turn against a scheme-less host:port", async () => {
  const { base, server } = await stub((_req, _body, res) => {
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "pong" } }] }));
  });
  try {
    const schemeless = base.replace(/^https?:\/\//, "");
    assert.ok(!schemeless.includes("://"), "test really is exercising the scheme-less form");
    const reply = await ollamaChat([{ role: "user", content: "ping" }], { host: schemeless });
    assert.equal(reply.content, "pong");
  } finally {
    server.close();
  }
});

test("ollamaChat surfaces a bad OLLAMA_HOST as a host error, not 'cannot reach Ollama'", async () => {
  await assert.rejects(
    () => ollamaChat([{ role: "user", content: "x" }], { host: "ftp://localhost:11434" }),
    /Invalid Ollama host/,
  );
});

// --- the timeout must cover the BODY, not just the headers ------------------
// stream:false means the whole completion arrives in the body. A server that
// answers 200 and then stalls mid-body used to hang forever, because the timer
// was cleared as soon as headers arrived.
test("ollamaChat times out when the server stalls mid-body after 200 headers", async () => {
  const server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"choices":[{"message":{"role":"assistant","content":"');
      // ...and then never finishes. No res.end().
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  try {
    await assert.rejects(
      () =>
        ollamaChat([{ role: "user", content: "x" }], {
          host: `http://127.0.0.1:${port}`,
          timeoutMs: 400,
        }),
      /timed out after/,
    );
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
