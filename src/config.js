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
 * - `speaker.heartbeat` — polling interval in ms; the runtime clamps it to
 *   1000, and a longer interval delays every reply.
 * - `openai.baseURL` — OpenAI-compatible endpoint, a bare host such as
 *   `https://api.deepseek.com` or a URL ending in `/v1`; it must not include
 *   `/chat/completions`.
 * - `openai.apiKey`, `openai.model` — credentials and model name.
 * - `prompt.system` — system prompt; `""` disables it.
 * - `context.historyMaxLength` — history messages sent per request; `0`
 *   disables the history.
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
  return parsed;
}
