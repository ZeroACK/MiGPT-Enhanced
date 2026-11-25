/**
 * Engine lifecycle and the polling loop.
 *
 * `MiGPT.start()` (i.e. `MiJiaEngine.start`) does three things at once: it sets
 * up the engine, initialises the Xiaomi services and then runs its own loop
 * forever with `Math.max(1000, speaker.heartbeat)` as the interval. That floor
 * cannot be lowered through configuration, and the loop swallows mistakes into
 * a never-resolving promise.
 *
 * This module performs the same setup through the public entry points
 * (`@mi-gpt/next/service` and `@mi-gpt/next/message`, both listed in the
 * package's `exports`) and runs its own loop, so:
 *
 * - the poll interval honours `speaker.heartbeat` down to `MIN_POLL_INTERVAL_MS`;
 * - a failed poll or a failed handler is logged instead of killing the process.
 */

import { MiGPT } from "@mi-gpt/next";
import { MiMessage } from "@mi-gpt/next/message";
import { MiService } from "@mi-gpt/next/service";

/** @typedef {import("./types.js").AppConfig} AppConfig */

/**
 * Lowest accepted poll interval. The Xiaomi conversation API is a cloud
 * endpoint; polling it much faster than this mostly burns quota.
 */
export const MIN_POLL_INTERVAL_MS = 300;

/** Falls back to the library default when the config does not set one. */
const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Sets up the engine without starting the library's own loop.
 *
 * The base engine implementation (`MiGPTEngine.prototype.start`) is reached
 * through the prototype chain because `MiJiaEngine.start` is the variant that
 * owns the loop; the base one only prints the banner, flips the status and
 * initialises `ChatBot` with the merged config.
 *
 * Once it resolves, `MiGPT.MiNA` and `MiGPT.MiOT` are available.
 *
 * @param {AppConfig} config
 * @returns {Promise<void>}
 */
export async function setupEngine(config) {
  const baseStart = Object.getPrototypeOf(Object.getPrototypeOf(MiGPT)).start;
  await baseStart.call(MiGPT, config);
  await MiService.init(MiGPT.config);
}

/**
 * Interval of the polling loop, in milliseconds.
 *
 * Unlike `MiJiaEngine.start`, which clamps `speaker.heartbeat` to at least one
 * second, the loop here honours the configured value down to
 * `MIN_POLL_INTERVAL_MS`.
 *
 * @param {AppConfig} config
 * @returns {number}
 */
export function pollInterval(config) {
  const configured = config.speaker?.heartbeat ?? DEFAULT_POLL_INTERVAL_MS;
  return Math.max(MIN_POLL_INTERVAL_MS, configured);
}

/**
 * Polls the conversation log and dispatches new utterances to the engine until
 * the engine is stopped.
 *
 * @param {AppConfig} config
 * @returns {Promise<void>}
 */
export async function runLoop(config) {
  const interval = pollInterval(config);
  console.log(`[migpt] polling every ${interval}ms`);

  while (MiGPT.status === "running") {
    let msg;
    try {
      msg = await MiMessage.fetchNextMessage();
    } catch (error) {
      console.error("[migpt] failed to poll the conversation:", error.message ?? error);
    }

    // Handlers run concurrently, as in the library: a slow LLM answer must not
    // delay the next poll.
    if (msg) {
      MiGPT.onMessage(msg).catch((error) => {
        console.error("[migpt] failed to handle a message:", error);
      });
    }

    await sleep(interval);
  }
}

/**
 * Sets up the engine and runs the polling loop until it stops.
 *
 * @param {AppConfig} config
 * @returns {Promise<void>}
 */
export async function startEngine(config) {
  await setupEngine(config);
  console.log("✅ 服务已启动...");
  await runLoop(config);
}
