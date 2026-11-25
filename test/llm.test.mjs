/**
 * Streaming tests: sentence splitting, speech cleanup and the SSE client.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeForSpeech, streamChat, takeSentences } from "../src/llm.js";
import { sseResponse } from "./fixtures.mjs";

test("markdown and emoji are cleaned before speaking", () => {
  assert.equal(sanitizeForSpeech("**你好**呀"), "你好呀");
  assert.equal(sanitizeForSpeech("看看 `console.log` 吧"), "看看 console.log 吧");
  assert.equal(sanitizeForSpeech("```js\nconst a = 1\n```"), "");
  assert.equal(sanitizeForSpeech("开心😀吗？"), "开心吗？");
  assert.equal(sanitizeForSpeech("  # 标题\n下一行 "), "标题 下一行");
});

test("complete sentences are split off, the tail stays buffered", () => {
  assert.deepEqual(takeSentences("你好。"), { sentences: ["你好。"], rest: "" });
  assert.deepEqual(takeSentences("你好。世界"), { sentences: ["你好。"], rest: "世界" });
  assert.deepEqual(takeSentences("你好。世界！"), {
    sentences: ["你好。", "世界！"],
    rest: "",
  });
  assert.deepEqual(takeSentences("还没说完"), { sentences: [], rest: "还没说完" });
  assert.deepEqual(takeSentences("换行\n下一句"), { sentences: ["换行\n"], rest: "下一句" });
});

test("a long run without punctuation is chunked", () => {
  const { sentences, rest } = takeSentences("啊".repeat(100));
  assert.equal(sentences.length, 1);
  assert.equal([...sentences[0]].length, 80);
  assert.equal([...rest].length, 20);
});

test("deltas are collected and the stream stops at [DONE]", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => sseResponse(["你好", "，", "世界。"]);
  try {
    const seen = [];
    const full = await streamChat({
      baseURL: "https://api.deepseek.com",
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      onDelta: (delta) => seen.push(delta),
    });
    assert.equal(full, "你好，世界。");
    assert.deepEqual(seen, ["你好", "，", "世界。"]);
  } finally {
    globalThis.fetch = previous;
  }
});

test("extra request parameters are merged into the body", async () => {
  const previous = globalThis.fetch;
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return sseResponse(["好。"]);
  };
  try {
    await streamChat({
      baseURL: "https://api.deepseek.com",
      apiKey: "key",
      model: "model",
      messages: [{ role: "user", content: "hi" }],
      params: { thinking: { type: "disabled" }, temperature: 0.2 },
      onDelta: () => {},
    });
  } finally {
    globalThis.fetch = previous;
  }
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.temperature, 0.2);
  assert.equal(body.stream, true);
  assert.equal(body.model, "model");
});

test("an endpoint that ignores stream:true is still handled", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "今天二十六号。" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  try {
    const seen = [];
    const full = await streamChat({
      baseURL: "https://api.deepseek.com",
      apiKey: "key",
      model: "model",
      messages: [],
      onDelta: (delta) => seen.push(delta),
    });
    assert.equal(full, "今天二十六号。");
    assert.deepEqual(seen, ["今天二十六号。"]);
  } finally {
    globalThis.fetch = previous;
  }
});

test("an HTTP error is reported with its status", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response("invalid key", { status: 401 });
  try {
    await assert.rejects(
      streamChat({
        baseURL: "https://api.deepseek.com",
        apiKey: "key",
        model: "model",
        messages: [],
        onDelta: () => {},
      }),
      /HTTP 401/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("an error event fails the stream", async () => {
  const previous = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: { message: "上下文过长" } })}\n\n`),
          );
          controller.close();
        },
      }),
      { status: 200 },
    );
  try {
    await assert.rejects(
      streamChat({
        baseURL: "https://api.deepseek.com",
        apiKey: "key",
        model: "model",
        messages: [],
        onDelta: () => {},
      }),
      /上下文过长/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});
