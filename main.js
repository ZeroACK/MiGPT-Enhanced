/**
 * MiGPT-Next entry point.
 *
 * Wiring only:
 *
 * - `src/config.js` reads `config.json`.
 * - `src/engine.js` sets the engine up and runs the polling loop.
 * - `src/hook.js` classifies every utterance and answers it, see the routing
 *   policy described in `src/router.js`.
 * - `src/prompt.js` + `prompt.md` hold the prompt template that is rendered
 *   for every utterance; `src/llm.js` streams the answer and `src/speech.js`
 *   speaks it sentence by sentence.
 * - `src/inventory.js` turns the Mi Home device list into the routing
 *   vocabulary and refreshes it periodically.
 *
 * The loop runs until SIGINT/SIGTERM (systemd sends the latter, see
 * `migpt-next.service`), which calls `MiGPT.stop()` and exits.
 *
 * Usage: `node main.js`
 *
 * @see https://github.com/idootop/migpt-next
 */

import { MiGPT } from "@mi-gpt/next";

import { CONFIG_PATH, loadConfig } from "./src/config.js";
import { runLoop, setupEngine } from "./src/engine.js";
import { onMessage } from "./src/hook.js";
import { DEVICE_REFRESH_MS, refreshInventory } from "./src/inventory.js";
import { loadPrompt } from "./src/prompt.js";

const fileConfig = loadConfig();
const promptTemplate = loadPrompt(fileConfig);
const config = { ...fileConfig, promptTemplate, onMessage };
const extraWords = fileConfig.extraDeviceWords ?? [];

/**
 * Sets the engine up, primes the routing vocabulary and starts polling.
 *
 * @returns {Promise<void>}
 */
async function main() {
  console.log(`[migpt] config: ${CONFIG_PATH}`);
  console.log(
    `[migpt] prompt: ${promptTemplate.path} (${promptTemplate.template.length} chars, in memory)`,
  );
  await setupEngine(config);
  console.log("✅ 服务已启动...");

  // A failed refresh only degrades routing to the fallback word list, so it
  // must not stop the assistant.
  await refreshInventory({ miot: MiGPT.MiOT, extraWords }).catch((error) => {
    console.error("[migpt] failed to load the device list:", error.message ?? error);
  });
  setInterval(
    () =>
      void refreshInventory({ miot: MiGPT.MiOT, extraWords }).catch((error) => {
        console.error("[migpt] failed to refresh the device list:", error.message ?? error);
      }),
    DEVICE_REFRESH_MS,
  ).unref();

  await runLoop(config);
}

main().catch((error) => {
  console.error("[migpt] failed to start:", error);
  process.exit(1);
});

// Stop gracefully on systemd (SIGTERM) or Ctrl+C (SIGINT).
for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.on(signal, async () => {
    console.log(`[migpt] received ${signal}, stopping...`);
    try {
      await MiGPT.stop();
    } catch (error) {
      console.error("[migpt] failed to stop:", error);
    }
    process.exit(0);
  });
}

// Log rejected promises instead of crashing silently.
process.on("unhandledRejection", (reason) => {
  console.error("[migpt] unhandled rejection:", reason);
});
