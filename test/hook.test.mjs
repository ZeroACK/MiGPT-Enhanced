/**
 * Hook tests: what the assistant speaks for a given utterance, using a stub
 * engine that records speech and a fake streaming endpoint that records the
 * requests sent to the model.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { onMessage } from "../src/hook.js";
import { clearHistory } from "../src/speech.js";
import { requests, setFakeReply, useFakeLLM, useTestPrompt, useTestVocabulary } from "./fixtures.mjs";

useTestVocabulary(["冷气", "音响"]);
useFakeLLM();

/** Speech recorded by the stub engine. */
const spoken = [];

test.beforeEach(() => {
  spoken.length = 0;
  clearHistory();
  requests.length = 0;
});

/**
 * Creates a stub engine.
 *
 * @returns {object}
 */
function makeEngine() {
  return useTestPrompt({
    config: { openai: { baseURL: "https://api.deepseek.com", model: "test-model" } },
    speaker: { play: async ({ text }) => spoken.push(text) },
    MiOT: { doAction: async (a, b, text) => spoken.push(`[fallback]${text}`) },
  });
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

test("dismissals are acknowledged without calling the model", async () => {
  const cases = ["没事了", "没事", "退下吧", "算了", "没事啦", "不聊了", "小爱同学，没事了"];
  for (const text of cases) {
    const before = requests.length;
    assert.equal(await speak(text), "好", text);
    assert.equal(requests.length, before, `${text} must not reach the model`);
  }
});

test("a dismissal inside a longer sentence still goes to the model", async () => {
  assert.equal(await speak("我没事"), "AI 回答: 我没事");
  assert.equal(await speak("没事是什么意思"), "AI 回答: 没事是什么意思");
});

test("the dismissive reply can be silenced", async () => {
  const engine = makeEngine();
  engine.config.dismissiveReply = "";
  assert.equal(await speak("退下吧", engine), undefined);
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

test("an empty LLM answer is not spoken", async (t) => {
  t.after(setFakeReply(""));
  assert.equal(await speak("今天几号"), undefined);
});

test("barge-in filler is spoken while the LLM is thinking", async () => {
  const engine = makeEngine();
  engine.config.bargeInText = "嗯";
  assert.equal(await speak("今天几号", engine), "嗯|AI 回答: 今天几号");
});

test("device commands are not interrupted", async () => {
  const engine = makeEngine();
  engine.config.bargeInText = "嗯";
  assert.equal(await speak("打开空调", engine), undefined);
});

test("without a filler nothing is interrupted", async () => {
  const engine = makeEngine();
  engine.config.bargeInText = "";
  assert.equal(await speak("今天几号", engine), "AI 回答: 今天几号");
});

test("the request is sent before the barge-in filler is played", async () => {
  const events = [];
  const restore = useFakeLLM({ onRequest: () => events.push("request") });
  const engine = makeEngine();
  engine.config.bargeInText = "嗯";
  engine.speaker.play = async ({ text }) => {
    events.push(`play:${text}`);
    return true;
  };
  try {
    await onMessage(engine, { text: "今天几号" });
  } finally {
    restore();
  }
  assert.equal(events[0], "request", events.join(","));
});

test("the filler does not poison the echo guard", async () => {
  const engine = makeEngine();
  engine.config.bargeInText = "嗯";
  await onMessage(engine, { text: "今天几号" });

  // The filler was spoken but not remembered, so repeating it is a real
  // utterance and must still get an answer.
  assert.equal(await speak("嗯"), "AI 回答: 嗯");
});

test("the wake phrase alone is ignored", async () => {
  assert.equal(await speak("小爱同学"), undefined);
  assert.equal(await speak("小爱同学。"), undefined);
  assert.equal(await speak("喂，小爱！"), undefined);
});

test("a request after the wake phrase is answered without it", async () => {
  assert.equal(await speak("小爱同学，今天几号"), "AI 回答: 今天几号");
});

test("a device command after the wake phrase stays silent", async () => {
  assert.equal(await speak("小爱同学，打开空调"), undefined);
});

test("a streamed answer is spoken sentence by sentence", async (t) => {
  t.after(setFakeReply("今天天气不错。我们出去玩吧！"));
  assert.deepEqual(await speakAsArray("讲讲天气"), ["今天天气不错。", "我们出去玩吧！"]);
});

test("markdown and emoji are removed before speaking", async (t) => {
  t.after(setFakeReply("**晚上好**😀呀"));
  assert.equal(await speak("现在几点"), "晚上好呀");
});

test("the prompt template is rendered for the current turn", async () => {
  await speak("今天几号");
  const system = requests.at(-1)?.body.messages[0];
  assert.equal(system?.role, "system");
  assert.match(system.content, /用户说：今天几号/);
  assert.match(system.content, /时间：\d/);
});

test("history from earlier turns reaches the template", async () => {
  await speak("第一条");
  await speak("第二条");
  const system = requests.at(-1)?.body.messages[0];
  assert.match(system?.content ?? "", /用户：第一条/);
});

test("history is sent as messages when the template has no placeholder", async () => {
  const engine = makeEngine();
  engine.config.promptTemplate = { path: "test/prompt.md", template: "只回答问题。" };
  await speak("第一条", engine);
  await speak("第二条", engine);
  const messages = requests.at(-1)?.body.messages ?? [];
  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
});

test("history keeps only the configured number of turns", async () => {
  const engine = makeEngine();
  engine.config.promptTemplate = { path: "test/prompt.md", template: "只回答问题。" };
  engine.config.context.historyTurns = 1;
  await speak("第一条", engine);
  await speak("第二条", engine);
  await speak("第三条", engine);
  const messages = requests.at(-1)?.body.messages ?? [];
  assert.deepEqual(
    messages.map((message) => message.content),
    ["只回答问题。", "第二条", "AI 回答: 第二条", "第三条"],
  );
});

test("a failing request is reported to the user", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    assert.equal(await speak("今天几号"), "抱歉，我这边出了点问题，请稍后再说一次吧");
  } finally {
    globalThis.fetch = previous;
  }
});

/**
 * Runs an utterance and returns the spoken pieces in order.
 *
 * @param {string} text
 * @returns {Promise<string[]>}
 */
async function speakAsArray(text) {
  await speak(text);
  return [...spoken];
}
