/**
 * MiGPT-Next entry point.
 *
 * Wiring only:
 *
 * - `src/config.js` reads `config.json`.
 * - `src/hook.js` classifies every utterance and answers it, see the routing
 *   policy described in `src/router.js`.
 * - `src/inventory.js` turns the Mi Home device list into the routing
 *   vocabulary and refreshes it periodically.
 *
 * `MiGPT.start` runs the polling loop forever, so it is not awaited; the
 * process is kept alive by that loop and stopped with SIGINT/SIGTERM (systemd
 * sends the latter, see `migpt-next.service`).
 *
 * Usage: `node main.js`
 *
 * @see https://github.com/idootop/migpt-next
 */

import { MiGPT } from "@mi-gpt/next";

import { CONFIG_PATH, loadConfig } from "./src/config.js";
import { onMessage } from "./src/hook.js";
import { DEVICE_REFRESH_MS, refreshInventory } from "./src/inventory.js";

const fileConfig = loadConfig();
const config = { ...fileConfig, onMessage };

/**
 * Starts the engine and the periodic inventory refresh.
 *
 * @returns {Promise<void>}
 */
async function main() {
  console.log(`[migpt] config: ${CONFIG_PATH}`);
  void MiGPT.start(config).catch((error) => {
    console.error("[migpt] engine stopped:", error);
    process.exit(1);
  });

  const extraWords = fileConfig.extraDeviceWords ?? [];
  await refreshInventory({ extraWords });
  setInterval(() => void refreshInventory({ extraWords }), DEVICE_REFRESH_MS).unref();
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
