/**
 * Log filter tests: the journal stays ASCII, library text survives.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { installLogFilter, stripPictographs } from "../src/log.js";

test("pictographs are stripped and spacing tidied", () => {
  assert.equal(stripPictographs("✅ 服务已启动..."), "服务已启动...");
  assert.equal(stripPictographs("hello 🔥 world"), "hello world");
  assert.equal(stripPictographs("[migpt] plain text"), "[migpt] plain text");
});

test("non-strings pass through untouched", () => {
  const error = new Error("boom");
  assert.equal(stripPictographs(error), error);
  assert.equal(stripPictographs(42), 42);
});

test("installLogFilter cleans every console method once", () => {
  const lines = [];
  const fakeConsole = {
    log: (...args) => lines.push(args),
    info: (...args) => lines.push(args),
    warn: (...args) => lines.push(args),
    error: (...args) => lines.push(args),
  };
  installLogFilter(fakeConsole);
  installLogFilter(fakeConsole);
  fakeConsole.error("❌ 没有找到账号或密码");
  fakeConsole.warn("⚠️ warning");
  assert.deepEqual(lines[0], ["没有找到账号或密码"]);
  assert.deepEqual(lines[1], ["warning"]);
});
