/**
 * Prompt template: loading `prompt.md` and rendering it per turn.
 *
 * The template is a Markdown file so it can be edited without touching code.
 * Placeholders use double braces (`{{query}}`); the runtime fills in what it
 * knows about the current turn before the prompt is sent to the LLM. Unknown
 * placeholders are rejected at startup, which turns typos into a clear error
 * instead of a literal `{{qurey}}` reaching the model.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { CONFIG_PATH } from "./config.js";

/** @typedef {import("./types.js").AppConfig} AppConfig */

/**
 * Placeholders the runtime always provides.
 *
 * - `query` — what the user just said.
 * - `time` — current date and time in Asia/Shanghai.
 * - `history` — the recent turns, rendered as text.
 */
export const BUILT_IN_VARS = ["query", "time", "history"];

/** Matches `{{name}}`, with optional padding inside the braces. */
const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Path of the template: `MIGPT_PROMPT` wins, then `promptFile` from the config
 * (relative to the config file), then `prompt.md` next to the config.
 *
 * @param {AppConfig} config
 * @returns {string}
 */
export function promptPath(config) {
  if (process.env.MIGPT_PROMPT) return resolve(process.env.MIGPT_PROMPT);
  const file = config.promptFile ?? "prompt.md";
  return resolve(dirname(CONFIG_PATH), file);
}

/**
 * Reads the template and checks its placeholders.
 *
 * @param {AppConfig} config
 * @returns {{ path: string, template: string }}
 */
export function loadPrompt(config) {
  const path = promptPath(config);
  let template;
  try {
    template = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read prompt template ${path}: ${error.message}`);
  }
  if (!template.trim()) {
    throw new Error(`prompt template ${path} is empty`);
  }

  const known = new Set([...BUILT_IN_VARS, ...Object.keys(config.context?.vars ?? {})]);
  const unknown = [...template.matchAll(PLACEHOLDER)]
    .map((match) => match[1])
    .filter((name) => !known.has(name));
  if (unknown.length > 0) {
    const names = [...new Set(unknown)].map((name) => `{{${name}}}`).join(", ");
    throw new Error(
      `prompt template ${path} uses unknown placeholder(s) ${names}; available: ${[...known].join(", ")}`,
    );
  }

  return { path, template };
}

/**
 * Returns true when the template references a placeholder.
 *
 * @param {string} template
 * @param {string} name
 * @returns {boolean}
 */
export function hasPlaceholder(template, name) {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(template);
}

/**
 * Replaces placeholders with their values. Unknown placeholders are left as
 * they are; `loadPrompt` rejects them before a template ever gets this far.
 *
 * @param {string} template
 * @param {Record<string, unknown>} vars
 * @returns {string}
 */
export function renderPrompt(template, vars) {
  return template.replace(PLACEHOLDER, (match, name) => {
    const value = vars[name];
    if (value === undefined || value === null) return match;
    return typeof value === "function" ? String(value()) : String(value);
  });
}

/**
 * Formats the current time the way the speaker would say it.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function formatTime(date = new Date()) {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Renders previous turns as text, for the `{{history}}` placeholder.
 *
 * @param {Array<{ role: "user" | "assistant", text: string }>} history
 * @returns {string}
 */
export function formatHistory(history) {
  if (history.length === 0) return "（暂无）";
  return history
    .map((entry) => `${entry.role === "user" ? "用户" : "助手"}：${entry.text}`)
    .join("\n");
}
