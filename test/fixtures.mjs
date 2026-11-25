/**
 * Fixtures shared by the tests.
 *
 * The device list mirrors this deployment's real Mi Home inventory, including
 * the MIoT model strings, so the vocabulary assertions exercise the same
 * model-prefix mapping the live service uses.
 */

import { buildDeviceWords, setDeviceWords } from "../src/router.js";

export const devices = [
  { name: "客厅摄像头", model: "chuangmi.camera.021a04" },
  { name: "卧室摄像头", model: "chuangmi.camera.021a04" },
  { name: "客厅电视", model: "xiaomi.tv.mih1" },
  { name: "客厅音箱", model: "xiaomi.wifispeaker.oh2p" },
  { name: "灯带", model: "xiaomi.light.bar2" },
  { name: "小爱音箱", model: "xiaomi.wifispeaker.l06a" },
  { name: "家门", model: "isa.magnet.dw2hl" },
  { name: "空调", model: "miir.aircondition.ir02" },
  { name: "手机", model: "mphone.phone.online" },
];

/**
 * Installs the fixture vocabulary (optionally with user aliases) and returns it.
 *
 * @param {string[]} [extraWords]
 * @returns {Set<string>}
 */
export function useTestVocabulary(extraWords = []) {
  const words = buildDeviceWords(devices, extraWords);
  setDeviceWords(words);
  return words;
}

/**
 * Prompt template used by the hook tests.
 *
 * It references all three built-in placeholders, matching the shape of the real
 * `prompt.md`.
 */
export const TEST_PROMPT =
  "你是测试助手。\n用户说：{{query}}\n时间：{{time}}\n最近对话：\n{{history}}";

/**
 * Prepares a stub engine for streaming answer tests: prompt template plus
 * playback pacing that does not actually wait.
 *
 * @param {object} engine
 * @returns {object}
 */
export function useTestPrompt(engine) {
  engine.config = engine.config ?? {};
  engine.config.promptTemplate = { path: "test/prompt.md", template: TEST_PROMPT };
  engine.config.speech = { leadUpMs: 0, msPerChar: 0 };
  engine.config.context = { historyTurns: 5, ...(engine.config.context ?? {}) };
  return engine;
}

/** @type {(query: string) => string} */
let fakeReply = (query) => `AI 回答: ${query}`;

/** Every request the fake endpoint received, newest last. */
export const requests = [];

/**
 * Changes the fake answer. Pass a function of the user utterance, or a string.
 *
 * @param {string | ((query: string) => string)} reply
 * @returns {() => void} restores the default reply
 */
export function setFakeReply(reply) {
  const previous = fakeReply;
  fakeReply = typeof reply === "function" ? reply : () => reply;
  return () => {
    fakeReply = previous;
  };
}

/**
 * Splits a reply into two-character deltas, the way a model streams tokens.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function deltas(text) {
  const chars = [...text];
  const chunks = [];
  for (let index = 0; index < chars.length; index += 2) {
    chunks.push(chars.slice(index, index + 2).join(""));
  }
  return chunks;
}

/**
 * Builds a `text/event-stream` response carrying the given deltas.
 *
 * @param {string[]} chunks
 * @returns {Response}
 */
export function sseResponse(chunks) {
  const encoder = new TextEncoder();
  const lines = [
    ...chunks.map(
      (chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
    ),
    "data: [DONE]\n\n",
  ];
  const body = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/**
 * Replaces `globalThis.fetch` with an OpenAI-compatible streaming endpoint that
 * answers from `fakeReply` and records every request.
 *
 * The response is handed over on the next macrotask, like a real endpoint that
 * needs at least a round trip: tests that check the barge-in filler depend on
 * the filler being spoken before the first sentence arrives.
 *
 * @param {object} [options]
 * @param {(request: { url: string, body: object }) => void} [options.onRequest]
 *   called as soon as the request is sent, before the reply is produced.
 * @returns {() => void} restores the previous `fetch`
 */
export function useFakeLLM({ onRequest } = {}) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}");
    requests.push({ url, body });
    onRequest?.({ url, body });
    const messages = body.messages ?? [];
    const query = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    await new Promise((done) => setTimeout(done, 1));
    return sseResponse(deltas(fakeReply(query)));
  };
  return () => {
    globalThis.fetch = previous;
  };
}
