/**
 * Loading and validating the JSON settings.
 *
 * Everything the deployment can express as data lives in `config.json`; this
 * module only reads it, so the rest of the code can assume a valid object.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {import("./types.js").AppConfig} AppConfig */

/**
 * Path of the settings file.
 *
 * Defaults to `config.json` in the project root (one level above `src/`), so
 * the service behaves the same no matter which directory it is started from.
 * `MIGPT_CONFIG` overrides it, which keeps side-by-side deployments and tests
 * from stepping on each other.
 */
export const CONFIG_PATH = process.env.MIGPT_CONFIG
  ? resolve(process.env.MIGPT_CONFIG)
  : fileURLToPath(new URL("../config.json", import.meta.url));

/**
 * Reads and validates the settings file.
 *
 * Recognised fields:
 *
 * - `debug` — verbose library logging.
 * - `speaker.did` — speaker name (or miotDID / MAC) as configured in Mi Home.
 * - `speaker.userId` — numeric Xiaomi ID; required, it is also sent as a login
 *   cookie, so an empty value breaks the login.
 * - `speaker.password` — used only when `passToken` is rejected and the
 *   password login does not require a captcha. May be empty if the token works.
 * - `speaker.passToken` — long-lived login token, tried before the password.
 *   How to obtain it: https://github.com/idootop/migpt-next/issues/4
 * - `speaker.heartbeat` — polling interval in ms. The library's own loop clamps
 *   it to 1000; the loop in `src/engine.js` honours it down to 300, which is
 *   what makes fast barge-in possible. A longer interval delays every reply.
 * - `bargeInText` — filler spoken as soon as an utterance that needs an LLM
 *   answer is detected, so Xiaoai's native answer is cut off while the request
 *   is in flight. Empty or missing disables the barge-in.
 * - `dismissiveReply` — answer to "没事了" / "退下吧" & co. No model call is
 *   made for those utterances; an empty string makes the speaker stay silent.
 * - `openai.baseURL` — OpenAI-compatible endpoint, a bare host such as
 *   `https://api.deepseek.com` or a URL ending in `/v1`; it must not include
 *   `/chat/completions`.
 * - `openai.apiKey`, `openai.model` — credentials and model name.
 * - `openai.params` — extra fields of the `/chat/completions` body, merged over
 *   `stream`. Use it for provider switches; on DeepSeek,
 *   `{"thinking":{"type":"disabled"}}` skips the reasoning pass and roughly
 *   halves the time to the first spoken words.
 * - `promptFile` — Markdown prompt template, relative to `config.json`
 *   (default `prompt.md`). `{{query}}`, `{{time}}` and `{{history}}` are filled
 *   in per turn; see `src/prompt.js`.
 * - `context.historyTurns` — how many exchanges (one user + one assistant
 *   message each) are kept for `{{history}}` and sent as messages when the
 *   template does not embed them; `0` disables the context window.
 * - `context.vars` — extra `{{placeholders}}` for the template.
 * - `speech.leadUpMs`, `speech.msPerChar` — pacing of streamed sentences; the
 *   defaults (400 ms, 180 ms per character) are estimates of the TTS speed.
 * - `extraDeviceWords` — extra spoken aliases for devices whose MI Home name or
 *   MIoT model does not cover them, e.g. a nickname such as "冷气".
 *
 * @returns {AppConfig}
 */
export function loadConfig() {
  let raw;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${CONFIG_PATH}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON in ${CONFIG_PATH}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${CONFIG_PATH} must contain a JSON object`);
  }
  if (!parsed.speaker || !parsed.speaker.did) {
    throw new Error(`${CONFIG_PATH}: "speaker.did" is required`);
  }
  if (parsed.extraDeviceWords !== undefined && !Array.isArray(parsed.extraDeviceWords)) {
    throw new Error(`${CONFIG_PATH}: "extraDeviceWords" must be an array of strings`);
  }
  if (parsed.bargeInText !== undefined && typeof parsed.bargeInText !== "string") {
    throw new Error(`${CONFIG_PATH}: "bargeInText" must be a string`);
  }
  if (parsed.dismissiveReply !== undefined && typeof parsed.dismissiveReply !== "string") {
    throw new Error(`${CONFIG_PATH}: "dismissiveReply" must be a string`);
  }
  if (parsed.promptFile !== undefined && typeof parsed.promptFile !== "string") {
    throw new Error(`${CONFIG_PATH}: "promptFile" must be a string`);
  }
  if (parsed.openai !== undefined) {
    if (typeof parsed.openai !== "object" || parsed.openai === null || Array.isArray(parsed.openai)) {
      throw new Error(`${CONFIG_PATH}: "openai" must be an object`);
    }
    if (parsed.openai.params !== undefined) {
      const params = parsed.openai.params;
      if (typeof params !== "object" || params === null || Array.isArray(params)) {
        throw new Error(`${CONFIG_PATH}: "openai.params" must be an object`);
      }
    }
  }
  if (parsed.context !== undefined) {
    if (typeof parsed.context !== "object" || parsed.context === null || Array.isArray(parsed.context)) {
      throw new Error(`${CONFIG_PATH}: "context" must be an object`);
    }
    const turns = parsed.context.historyTurns;
    if (turns !== undefined && (typeof turns !== "number" || !Number.isInteger(turns) || turns < 0)) {
      throw new Error(`${CONFIG_PATH}: "context.historyTurns" must be a non-negative integer`);
    }
  }
  if (parsed.speech !== undefined) {
    if (typeof parsed.speech !== "object" || parsed.speech === null || Array.isArray(parsed.speech)) {
      throw new Error(`${CONFIG_PATH}: "speech" must be an object`);
    }
    for (const key of ["leadUpMs", "msPerChar"]) {
      if (parsed.speech[key] !== undefined && typeof parsed.speech[key] !== "number") {
        throw new Error(`${CONFIG_PATH}: "speech.${key}" must be a number of milliseconds`);
      }
    }
  }
  return parsed;
}
