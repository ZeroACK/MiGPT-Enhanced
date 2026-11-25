/**
 * Speaking replies and remembering them.
 *
 * MiGPT can only react to what the speaker already recorded, so a reply must be
 * played through the speaker's own TTS. The echo guard keeps the resulting
 * playback from being mistaken for a new user utterance.
 */

/** @typedef {import("./types.js").Engine} Engine */
/** @typedef {import("./types.js").Message} Message */

/** How long a spoken reply stays in the echo guard, in milliseconds. */
const ECHO_TTL_MS = 60_000;

/** Maximum number of remembered replies. */
const ECHO_HISTORY_LIMIT = 20;

/**
 * Recently spoken replies mapped to the time they were played.
 *
 * @type {Map<string, number>}
 */
const spokenReplies = new Map();

/**
 * Normalizes a phrase so that punctuation and whitespace do not defeat the echo
 * guard.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return text.replace(/\s+/g, "").replace(/[，。！？、,.!?~～]/g, "");
}

/**
 * Returns true when the utterance is something MiGPT itself just said.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isEcho(text) {
  const key = normalize(text);
  const spokenAt = spokenReplies.get(key);
  if (spokenAt === undefined) return false;
  if (Date.now() - spokenAt > ECHO_TTL_MS) {
    spokenReplies.delete(key);
    return false;
  }
  return true;
}

/**
 * Remembers a reply and drops expired entries.
 *
 * @param {string} text
 * @returns {void}
 */
export function rememberReply(text) {
  const now = Date.now();
  spokenReplies.set(normalize(text), now);
  for (const [key, spokenAt] of spokenReplies) {
    if (now - spokenAt > ECHO_TTL_MS) spokenReplies.delete(key);
  }
  while (spokenReplies.size > ECHO_HISTORY_LIMIT) {
    const oldest = spokenReplies.keys().next().value;
    spokenReplies.delete(oldest);
  }
}

/**
 * Plays a reply through the speaker and remembers it.
 *
 * `speaker.play` uses the MiNA `text_to_speech` API, which interrupts whatever
 * Xiaoai is currently saying.
 *
 * @param {Engine} engine
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function say(engine, text) {
  if (!text) return;
  rememberReply(text);

  let played = false;
  try {
    played = await engine.speaker.play({ text });
  } catch (error) {
    console.warn("[migpt] speaker.play failed:", error);
  }
  if (played) return;

  // Fallback for firmware where MiNA TTS is unavailable: MiOT text playback.
  try {
    await engine.MiOT.doAction(7, 3, text);
  } catch (error) {
    console.error("[migpt] failed to play reply:", error);
  }
}

/**
 * Asks the LLM and speaks the answer.
 *
 * @param {Engine} engine
 * @param {Message} msg
 * @returns {Promise<void>}
 */
export async function answerWithAI(engine, msg) {
  const { text } = (await engine.askAI(msg)) ?? {};
  const reply = text?.trim();
  if (!reply) {
    console.warn(`[migpt] empty AI reply for: ${msg.text}`);
    return;
  }
  console.log(`[migpt] ${engine.config.openai.baseURL} -> ${reply}`);
  await say(engine, reply);
}
