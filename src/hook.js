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
 * 3. wake phrase only ("小爱同学") — ignore; the rest of the phrase, if any,
 *    is what gets classified.
 * 4. fixed phrases — answer verbatim.
 * 5. dismissals ("没事了", "退下吧") — short acknowledgement, no model call.
 * 6. native operation (device control, media) — stay silent, the speaker did it.
 * 7. everything else — ask the LLM and speak the answer.
 */

import {
  DISMISSIVE_REPLY,
  FIXED_REPLIES,
  WELCOME_BACK_PHRASE,
  WELCOME_BACK_REPLY,
  isDismissive,
} from "./replies.js";
import { classifyRoute, stripWakeWord } from "./router.js";
import { answerWithAI, cancelResponse, isEcho, say } from "./speech.js";

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

  // A real utterance means the user has moved on: stop the answer that is
  // still streaming or being spoken. Echoes are excluded above, otherwise the
  // assistant would interrupt itself while talking.
  cancelResponse();

  // Waking the speaker up is not a question. Strip the phrase; when nothing
  // remains, stay silent instead of letting the LLM answer "小爱同学".
  const request = stripWakeWord(text);
  if (!request) {
    console.log(`[migpt] ignore wake word: ${text}`);
    return { handled: true };
  }
  const effective =
    request === text ? msg : /** @type {Message} */ ({ ...msg, text: request });

  const fixed = FIXED_REPLIES[request];
  if (fixed) {
    await say(engine, fixed);
    return { handled: true };
  }
  if (request === WELCOME_BACK_PHRASE) {
    await say(engine, WELCOME_BACK_REPLY);
    return { handled: true };
  }

  // "没事了" / "退下吧" is not a question: acknowledge briefly and stay out of
  // the model's way. An empty `dismissiveReply` keeps the speaker silent.
  if (isDismissive(request)) {
    console.log(`[migpt] dismissive: ${request}`);
    const reply = engine.config?.dismissiveReply ?? DISMISSIVE_REPLY;
    if (typeof reply === "string" && reply) await say(engine, reply);
    return { handled: true };
  }

  const route = classifyRoute(request);
  if (route.handledBy === "native") {
    console.log(`[migpt] native (${route.reason}): ${request}`);
    return { handled: true };
  }

  console.log(`[migpt] llm (${route.reason}): ${request}`);

  // Start the request before the filler, not after it: the TTS round trip would
  // otherwise add a few hundred milliseconds to every answer. The filler is not
  // added to the echo guard, because the user may repeat it.
  const answering = answerWithAI(engine, effective);
  const bargeInText = engine.config?.bargeInText;
  try {
    if (typeof bargeInText === "string" && bargeInText) {
      await say(engine, bargeInText, { remember: false });
    }
  } finally {
    await answering;
  }
  return { handled: true };
}
