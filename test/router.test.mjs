/**
 * Routing tests: the vocabulary derived from the device inventory, and the
 * native/LLM decision for typical utterances.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildDeviceWords, classifyRoute, setDeviceWords } from "../src/router.js";
import { devices, useTestVocabulary } from "./fixtures.mjs";

const words = useTestVocabulary(["冷气", "音响"]);

test("model prefixes contribute category words", () => {
  for (const expected of ["电视", "灯", "空调", "音箱", "摄像头", "门", "手机"]) {
    assert.ok(words.has(expected), `missing category word: ${expected}`);
  }
});

test("device names are indexed, split and lowercased", () => {
  assert.ok(words.has("客厅摄像头"));
  assert.ok(words.has("客厅电视"));
  assert.ok(words.has("tv"));
  assert.ok(words.has("device"));
  for (const word of words) assert.equal(word, word.toLowerCase());
});

test("user aliases are merged", () => {
  assert.ok(words.has("冷气"));
  assert.ok(words.has("音响"));
});

test("buildDeviceWords tolerates incomplete devices", () => {
  const built = buildDeviceWords([{}, { name: "" }, { model: "xiaomi.tv.mih1" }]);
  assert.ok(built.has("电视"));
  assert.equal(buildDeviceWords([]).size, 0);
});

test("unknown models add nothing", () => {
  const built = buildDeviceWords([{ name: "灯", model: "vendor.unknown.1" }]);
  assert.deepEqual([...built], ["灯"]);
});

test("classifyRoute routes device commands natively", () => {
  const native = [
    ["打开空调", "device"],
    ["把客厅的灯打开", "灯 comes from the light model"],
    ["电视关机", "电视 comes from xiaomi.tv.*"],
    ["关灯", "short verb + device"],
    ["空调调到26度", "device + value"],
    ["能不能把灯打开", "action question still controls the device"],
  ];
  for (const [text, why] of native) {
    assert.equal(classifyRoute(text).handledBy, "native", `${text} (${why})`);
  }
});

test("classifyRoute routes media commands natively", () => {
  for (const text of ["播放周杰伦的歌", "下一首", "音量调到50", "帮我放首歌"]) {
    assert.equal(classifyRoute(text).handledBy, "native", text);
  }
});

test("classifyRoute sends questions and conversation to the LLM", () => {
  const llm = [
    ["怎么关空调", "asks for instructions"],
    ["空调为什么这么吵", "device question"],
    ["灯为什么一闪一闪", "device question"],
    ["空调多少钱", "price question"],
    ["今天天气怎么样", "conversation"],
    ["讲个笑话", "conversation"],
    ["查询电费", "conversation"],
    ["开个玩笑", "开 alone is not a strong verb prefix"],
    ["今天几号", "conversation"],
  ];
  for (const [text, why] of llm) {
    assert.equal(classifyRoute(text).handledBy, "llm", `${text} (${why})`);
  }
});

test("a device word without a command verb is a conversation", () => {
  assert.equal(classifyRoute("我家空调").handledBy, "llm");
});

test("fallback vocabulary keeps basic device words", () => {
  setDeviceWords(["灯", "空调"]);
  assert.equal(classifyRoute("关灯").handledBy, "native");
  assert.equal(classifyRoute("讲个笑话").handledBy, "llm");
  // Restore for the other tests in this file.
  useTestVocabulary(["冷气", "音响"]);
});

test("fixture vocabulary is what the other tests expect", () => {
  assert.equal(devices.length, 9);
  assert.ok(words.size > 20);
});
