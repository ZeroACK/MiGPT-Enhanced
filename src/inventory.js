/**
 * Device inventory: fills the routing vocabulary from the Mi Home account.
 *
 * `MiGPT.start` never resolves, so the MiOT client only exists after the engine
 * has initialised. Everything here therefore waits for it instead of assuming
 * it, and degrades to the built-in vocabulary in `src/router.js` when the
 * account or the network is unavailable.
 */

import { MiGPT } from "@mi-gpt/next";

import { buildDeviceWords, getDeviceWords, setDeviceWords } from "./router.js";

/** How often the inventory is refreshed, in milliseconds. */
export const DEVICE_REFRESH_MS = 10 * 60_000;

/** How long to wait for the MiOT client after the engine was started. */
const MIOT_TIMEOUT_MS = 60_000;

/**
 * Waits until MiGPT has initialised its MiOT client.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<object | undefined>} the MiOT client, or `undefined` on timeout.
 */
export async function waitForMiot(timeoutMs = MIOT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (MiGPT.MiOT) return MiGPT.MiOT;
    await new Promise((done) => setTimeout(done, 200));
  }
  return undefined;
}

/**
 * Loads the device vocabulary and logs a short summary.
 *
 * Returns `false` when the vocabulary could not be replaced, so the caller can
 * keep the previous one (or the built-in fallback) rather than going blank.
 *
 * @param {object} [options]
 * @param {object} [options.miot] MiOT client; defaults to waiting for MiGPT.
 * @param {readonly string[]} [options.extraWords] aliases from `config.json`.
 * @returns {Promise<boolean>}
 */
export async function refreshInventory({ miot, extraWords = [] } = {}) {
  const client = miot ?? (await waitForMiot());
  if (!client) {
    console.warn("[migpt] MIoT is not ready, keeping the current vocabulary");
    return false;
  }

  let devices;
  try {
    devices = await client.getDevices();
  } catch (error) {
    console.warn("[migpt] failed to load the device list:", error.message ?? error);
    return false;
  }

  const words = buildDeviceWords(devices, extraWords);
  if (words.size === 0) {
    console.warn("[migpt] device list is empty, keeping the current vocabulary");
    return false;
  }

  setDeviceWords(words);
  const sample = [...getDeviceWords()].slice(0, 12).join("、");
  console.log(`[migpt] routing vocabulary: ${words.size} words (${sample}…)`);
  return true;
}
