/**
 * Aho–Corasick tests: matching semantics the router relies on, plus the early
 * stop that keeps routing independent of vocabulary size.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { AhoCorasick } from "../src/aho.js";

test("matchFirst reports pattern, start and end", () => {
  const matcher = new AhoCorasick(["灯", "空调"]);
  assert.deepEqual(matcher.matchFirst("打开空调"), { pattern: "空调", start: 2, end: 4 });
});

test("the earliest finishing match wins", () => {
  const matcher = new AhoCorasick(["灯", "灯带"]);
  assert.equal(matcher.matchFirst("打开灯带").pattern, "灯");
});

test("patterns finishing together: the longest wins", () => {
  const matcher = new AhoCorasick(["同学", "小爱同学"]);
  assert.equal(matcher.matchFirst("小爱同学，今天几号").pattern, "小爱同学");
});

test("a suffix match found through a failure link is reported", () => {
  const matcher = new AhoCorasick(["灯", "带"]);
  assert.equal(matcher.matchFirst("打开灯带").pattern, "灯");
  assert.equal(matcher.has("打开灯带"), true);
});

test("has stops at the first completion", () => {
  const matcher = new AhoCorasick(["为什么"]);
  assert.equal(matcher.has("空调为什么这么吵"), true);
  assert.equal(matcher.has("空调多少钱"), false);
});

test("matchPrefix only matches at the start", () => {
  const matcher = new AhoCorasick(["音量", "声音"]);
  assert.equal(matcher.matchPrefix("音量调到50").pattern, "音量");
  assert.equal(matcher.matchPrefix("把音量调到50"), undefined);
});

test("matchPrefix returns the longest prefix", () => {
  const matcher = new AhoCorasick(["放", "放首歌", "放首歌吧"]);
  assert.equal(matcher.matchPrefix("放首歌吧").pattern, "放首歌吧");
});

test("empty and non-string patterns are ignored", () => {
  const matcher = new AhoCorasick(["", "灯"]);
  assert.equal(matcher.size, 1);
  assert.equal(matcher.matchFirst(""), undefined);
});

test("patterns can be added after construction", () => {
  const matcher = new AhoCorasick(["电视"]);
  matcher.add("空调");
  assert.equal(matcher.matchFirst("空调调到26度").pattern, "空调");
  assert.equal(matcher.size, 2);
});

test("matching is independent of vocabulary size", () => {
  const words = Array.from({ length: 5000 }, (_, index) => `设备${index}`);
  words.push("空调");
  const matcher = new AhoCorasick(words);
  assert.equal(matcher.matchFirst("打开空调").pattern, "空调");
});
