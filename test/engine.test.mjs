/**
 * Engine tests: the poll interval, which is the whole reason the project runs
 * its own loop instead of `MiGPT.start`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { MIN_POLL_INTERVAL_MS, pollInterval } from "../src/engine.js";

test("the configured heartbeat is used as-is", () => {
  assert.equal(pollInterval({ speaker: { heartbeat: 500 } }), 500);
  assert.equal(pollInterval({ speaker: { heartbeat: 2000 } }), 2000);
});

test("a missing heartbeat falls back to one second", () => {
  assert.equal(pollInterval({}), 1000);
  assert.equal(pollInterval({ speaker: {} }), 1000);
});

test("a heartbeat below the floor is clamped", () => {
  assert.equal(pollInterval({ speaker: { heartbeat: 10 } }), MIN_POLL_INTERVAL_MS);
  assert.equal(pollInterval({ speaker: { heartbeat: 0 } }), MIN_POLL_INTERVAL_MS);
});
