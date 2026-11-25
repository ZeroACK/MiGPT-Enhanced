/**
 * Hook tests: what the assistant speaks for a given utterance, using a stub
 * engine that records speech instead of talking to the speaker.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { onMessage } from "../src/hook.js";
import { useTestVocabulary } from "./fixtures.mjs";

useTestVocabulary(["冷气", "音响"]);

/** Speech recorded by the stub engine. */
const spoken = [];

/**
 * Creates a stub engine.
 *
 * @param {string} [reply]
 * @returns {object}
 */
function makeEngine(reply = "AI 回答") {
  return {
    config: { openai: { baseURL: "https://api.deepseek.com" } },
    speaker: { play: async ({ text }) => spoken.push(text) },
    MiOT: { doAction: async (a, b, text) => spoken.push(`[fallback]${text}`) },
    askAI: async (msg) => ({ text: `${reply}: ${msg.text}` }),
  };
}

/**
 * Runs one utterance and returns what was spoken (`undefined` = silence).
 *
 * @param {string} text
 * @param {object} [engine]
 * @returns {Promise<string | undefined>}
 */
async function speak(text, engine = makeEngine()) {
  spoken.length = 0;
  const result = await onMessage(engine, { text });
  assert.equal(result?.handled, true, `hook must handle ${JSON.stringify(text)}`);
  return spoken.length ? spoken.join("|") : undefined;
}

test("empty input is swallowed", async () => {
  assert.equal(await speak(""), undefined);
  assert.equal(await speak("   "), undefined);
});

test("fixed phrases keep their wording", async () => {
  assert.equal(await speak("你好"), "你好");
  assert.equal(await speak("我是复读机"), "我是复读机");
  assert.equal(await speak("我来了"), "太好了！你终于踏马来了，想死老子了");
});

test("conversation and questions are answered by the LLM", async () => {
  assert.equal(await speak("今天几号"), "AI 回答: 今天几号");
  assert.equal(await speak("查询电费"), "AI 回答: 查询电费");
  assert.equal(await speak("怎么关空调"), "AI 回答: 怎么关空调");
});

test("native operations stay silent", async () => {
  for (const text of ["打开空调", "把客厅的灯打开", "电视关机", "播放周杰伦的歌"]) {
    assert.equal(await speak(text), undefined, text);
  }
});

test("echo of a previous reply is ignored", async () => {
  spoken.length = 0;
  await onMessage(makeEngine(), { text: "测试回声" });
  const replay = await onMessage(makeEngine(), { text: "AI 回答: 测试回声" });
  assert.equal(replay?.handled, true);
  assert.deepEqual(spoken, ["AI 回答: 测试回声"]);
});

test("TTS failure falls back to MIoT.doAction", async () => {
  const broken = makeEngine();
  broken.speaker.play = async () => {
    throw new Error("boom");
  };
  assert.equal(await speak("测试回退", broken), "[fallback]AI 回答: 测试回退");
});

test("an empty LLM answer is not spoken", async () => {
  const engine = makeEngine();
  engine.askAI = async () => ({ text: "  " });
  assert.equal(await speak("今天几号", engine), undefined);
});
