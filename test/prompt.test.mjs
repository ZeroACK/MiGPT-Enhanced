/**
 * Prompt tests: placeholder rendering, validation and history formatting.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  formatHistory,
  formatTime,
  hasPlaceholder,
  loadPrompt,
  renderPrompt,
} from "../src/prompt.js";

test("placeholders are replaced, unknown ones are left alone", () => {
  assert.equal(
    renderPrompt("用户说：{{query}}，时间：{{time}}", { query: "几号", time: "十点" }),
    "用户说：几号，时间：十点",
  );
  assert.equal(renderPrompt("{{ query }}", { query: "值" }), "值");
  assert.equal(renderPrompt("{{unknown}}", {}), "{{unknown}}");
  assert.equal(renderPrompt("{{fn}}", { fn: () => "调用" }), "调用");
});

test("placeholder detection", () => {
  assert.equal(hasPlaceholder("{{history}}", "history"), true);
  assert.equal(hasPlaceholder("{{ history }}", "history"), true);
  assert.equal(hasPlaceholder("{{query}}", "history"), false);
});

test("history is rendered as readable turns", () => {
  assert.equal(formatHistory([]), "（暂无）");
  assert.equal(
    formatHistory([
      { role: "user", text: "今天几号" },
      { role: "assistant", text: "二十六号" },
    ]),
    "用户：今天几号\n助手：二十六号",
  );
});

test("the time is formatted with a weekday", () => {
  assert.match(formatTime(new Date("2026-11-26T02:48:00+08:00")), /2026/);
  assert.match(formatTime(new Date("2026-11-26T02:48:00+08:00")), /星期四/);
});

test("a valid template is loaded", () => {
  withTemplate("你好 {{query}}，现在是 {{time}}。\n{{history}}", (file, restore) => {
    const prompt = loadPrompt({ context: { vars: {} } });
    assert.equal(prompt.path, file);
    assert.match(prompt.template, /你好 \{\{query\}\}/);
    restore();
  });
});

test("custom variables from context.vars are allowed", () => {
  withTemplate("我是 {{name}}", (_, restore) => {
    assert.doesNotThrow(() => loadPrompt({ context: { vars: { name: "小助手" } } }));
    restore();
  });
});

test("unknown placeholders are rejected with the available names", () => {
  withTemplate("你好 {{qurey}}", (_, restore) => {
    assert.throws(() => loadPrompt({}), /unknown placeholder.*\{\{qurey\}\}.*available/);
    restore();
  });
});

test("an empty or missing template is rejected", () => {
  withTemplate("   \n", (_, restore) => {
    assert.throws(() => loadPrompt({}), /is empty/);
    restore();
  });
  const previous = process.env.MIGPT_PROMPT;
  process.env.MIGPT_PROMPT = join(tmpdir(), "definitely-missing-prompt.md");
  try {
    assert.throws(() => loadPrompt({}), /cannot read prompt template/);
  } finally {
    if (previous === undefined) delete process.env.MIGPT_PROMPT;
    else process.env.MIGPT_PROMPT = previous;
  }
});

/**
 * Writes a temporary template, points `MIGPT_PROMPT` at it and runs `fn`.
 *
 * @param {string} content
 * @param {(file: string, restore: () => void) => void} fn
 * @returns {void}
 */
function withTemplate(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), "migpt-prompt-"));
  const file = join(dir, "prompt.md");
  writeFileSync(file, content);

  const previous = process.env.MIGPT_PROMPT;
  process.env.MIGPT_PROMPT = file;
  const restore = () => {
    if (previous === undefined) delete process.env.MIGPT_PROMPT;
    else process.env.MIGPT_PROMPT = previous;
    rmSync(dir, { recursive: true, force: true });
  };
  fn(file, restore);
}
