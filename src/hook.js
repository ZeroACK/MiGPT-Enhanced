/**
 * The `onMessage` hook.
 *
 * Returning `{ handled: true }` stops the library's default flow, which would
 * otherwise apply its built-in `callAIKeywords` prefix matching. This deployment
 * deliberately bypasses that: every utterance is classified by `classifyRoute`
 * instead, so the LLM answers anything the speaker cannot do itself.
 *
 * Order of decisions:
 *
 * 1. empty text — nothing to do.
 * 2. echo of our own playback — ignore (loop guard).
 * 3. fixed phrases — answer verbatim.
 * 4. native operation (device control, media) — stay silent, the speaker did it.
 * 5. everything else — ask the LLM and speak the answer.
 */

import { FIXED_REPLIES, WELCOME_BACK_PHRASE, WELCOME_BACK_REPLY } from "./replies.js";
import { classifyRoute } from "./router.js";
import { answerWithAI, isEcho, say } from "./speech.js";

/** @typedef {import("./types.js").Engine} Engine */
/** @typedef {import("./types.js").Message} Message */

/**
 * Handles one utterance from the speaker.
 *
 * @param {Engine} engine
 * @param {Message} msg
 * @returns {Promise<{ handled: true }>}
 */
export async function onMessage(engine, msg) {
  const text = (msg.text ?? "").trim();
  if (!text) return { handled: true };

  if (isEcho(text)) {
    console.log(`[migpt] ignore echo: ${text}`);
    return { handled: true };
  }

  const fixed = FIXED_REPLIES[text];
  if (fixed) {
    await say(engine, fixed);
    return { handled: true };
  }
  if (text === WELCOME_BACK_PHRASE) {
    await say(engine, WELCOME_BACK_REPLY);
    return { handled: true };
  }

  const route = classifyRoute(text);
  if (route.handledBy === "native") {
    console.log(`[migpt] native (${route.reason}): ${text}`);
    return { handled: true };
  }

  console.log(`[migpt] llm (${route.reason}): ${text}`);
  await answerWithAI(engine, msg);
  return { handled: true };
}
