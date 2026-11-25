/**
 * Speaking replies, remembering them, and streaming them sentence by sentence.
 *
 * MiGPT can only react to what the speaker already recorded, so a reply must be
 * played through the speaker's own TTS. The echo guard keeps the resulting
 * playback from being mistaken for a new user utterance.
 *
 * The answer is streamed: every finished sentence is spoken while the rest of
 * the answer is still being generated. Because a new `text_to_speech` call
 * interrupts the previous one, playback is paced — each sentence is waited for
 * before the next one is sent.
 */

import { sanitizeForSpeech, streamChat, takeSentences } from "./llm.js";
import { formatHistory, formatTime, hasPlaceholder, renderPrompt } from "./prompt.js";

/** @typedef {import("./types.js").Engine} Engine */
/** @typedef {import("./types.js").Message} Message */

/** How long a spoken reply stays in the echo guard, in milliseconds. */
const ECHO_TTL_MS = 60_000;

/** Maximum number of remembered replies. */
const ECHO_HISTORY_LIMIT = 20;

/** Assumed head start of the TTS (synthesis + playback start), in milliseconds. */
const DEFAULT_LEAD_UP_MS = 400;

/** Assumed speaking speed of the TTS, in milliseconds per character. */
const DEFAULT_MS_PER_CHAR = 180;

/** How often the player state is checked once the estimate has passed. */
const STATUS_POLL_MS = 250;

/** Upper bound for waiting on the player state, so a stuck status cannot hang. */
const STATUS_POLL_TIMEOUT_MS = 2500;

/**
 * Recently spoken replies mapped to the time they were played.
 *
 * @type {Map<string, number>}
 */
const spokenReplies = new Map();

/**
 * Completed turns, used for `context.historyTurns` and `{{history}}`.
 *
 * @type {Array<{ role: "user" | "assistant", text: string }>}
 */
const history = [];

/** Abort controller of the answer currently being streamed, if any. */
/** @type {AbortController | null} */
let activeController = null;

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
 * Stops the answer that is currently being streamed or spoken.
 *
 * Called when a new utterance arrives: the user has moved on, so the rest of
 * the previous answer would only talk over them.
 *
 * @returns {void}
 */
export function cancelResponse() {
  if (!activeController) return;
  activeController.abort();
  activeController = null;
}

/**
 * Forgets the conversation history (tests, and a clean slate on restart).
 *
 * @returns {void}
 */
export function clearHistory() {
  history.length = 0;
}

/**
 * Returns the remembered turns, oldest first.
 *
 * @returns {Array<{ role: "user" | "assistant", text: string }>}
 */
export function getHistory() {
  return history.map((entry) => ({ ...entry }));
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Plays a reply through the speaker and remembers it.
 *
 * `speaker.play` uses the MiNA `text_to_speech` API, which interrupts whatever
 * Xiaoai is currently saying.
 *
 * @param {Engine} engine
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.remember] whether the text joins the echo guard;
 *   `false` for barge-in fillers, which the user may well say afterwards.
 * @returns {Promise<void>}
 */
export async function say(engine, text, { remember = true } = {}) {
  if (!text) return;
  if (remember) rememberReply(text);

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
 * Waits until a spoken sentence has most likely finished.
 *
 * The TTS call returns as soon as the request is accepted, so playing the next
 * sentence right away would cut this one off. The length of the text gives a
 * first estimate; the player status then confirms the end, which costs one or
 * two extra requests per sentence.
 *
 * @param {Engine} engine
 * @param {string} text
 * @param {number} startedAt `Date.now()` taken right before `say`.
 * @param {{ leadUpMs?: number, msPerChar?: number }} [config]
 * @returns {Promise<void>}
 */
async function waitForPlayback(engine, text, startedAt, config = {}) {
  const leadUpMs = config.leadUpMs ?? DEFAULT_LEAD_UP_MS;
  const msPerChar = config.msPerChar ?? DEFAULT_MS_PER_CHAR;
  const estimate = leadUpMs + [...text].length * msPerChar;
  const remaining = estimate - (Date.now() - startedAt);
  if (remaining > 0) await sleep(remaining);

  const getStatus = engine.MiNA?.getStatus;
  if (typeof getStatus !== "function") return;

  const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const status = await engine.MiNA.getStatus();
      if (status?.status !== "playing") return;
    } catch (error) {
      console.warn("[migpt] failed to read the player status:", error);
      return;
    }
    await sleep(STATUS_POLL_MS);
  }
}

/**
 * Number of messages kept for the context window: one exchange is two messages.
 *
 * @param {object} config
 * @returns {number}
 */
function maxHistoryMessages(config) {
  const turns = Math.max(0, config.context?.historyTurns ?? 0);
  return turns * 2;
}

/**
 * Adds a turn to the conversation history, keeping at most `maxLength` messages.
 *
 * @param {"user" | "assistant"} role
 * @param {string} text
 * @param {number} maxLength
 * @returns {void}
 */
function rememberTurn(role, text, maxLength) {
  if (maxLength <= 0) return;
  history.push({ role, text });
  while (history.length > maxLength) history.shift();
}

/**
 * Renders the prompt template for the current turn.
 *
 * @param {Engine} engine
 * @param {Message} msg
 * @returns {Array<{ role: string, content: string }>}
 */
function buildRequest(engine, msg) {
  const config = engine.config ?? {};
  const { promptTemplate } = config;
  if (!promptTemplate?.template) {
    throw new Error("the prompt template is not loaded, see src/prompt.js");
  }

  const maxMessages = maxHistoryMessages(config);
  const recent = maxMessages > 0 ? history.slice(-maxMessages) : [];
  const vars = {
    query: msg.text,
    time: formatTime(),
    history: formatHistory(recent),
    ...(config.context?.vars ?? {}),
  };
  const system = renderPrompt(promptTemplate.template, vars);

  const messages = [{ role: "system", content: system }];
  // Either the template embeds the history as text, or it is sent as turns;
  // sending both would duplicate the context.
  if (!hasPlaceholder(promptTemplate.template, "history")) {
    for (const entry of recent) messages.push({ role: entry.role, content: entry.text });
  }
  messages.push({ role: "user", content: msg.text });
  return messages;
}

/**
 * Asks the LLM and speaks the answer sentence by sentence while it streams in.
 *
 * @param {Engine} engine
 * @param {Message} msg
 * @returns {Promise<void>}
 */
export async function answerWithAI(engine, msg) {
  const config = engine.config ?? {};
  const openai = config.openai ?? {};
  const maxMessages = maxHistoryMessages(config);
  const messages = buildRequest(engine, msg);
  const startedAt = Date.now();
  let firstDeltaAt = 0;
  let firstAudioAt = 0;

  console.log(`[migpt] ${openai.baseURL} (${openai.model}) -> ${msg.text}`);

  cancelResponse();
  const controller = new AbortController();
  activeController = controller;

  let buffer = "";
  let reply = "";

  /**
   * Speaks one chunk and waits for it to be finished before returning.
   *
   * @param {string} raw
   * @returns {Promise<void>}
   */
  const speakChunk = async (raw) => {
    const text = sanitizeForSpeech(raw);
    if (!text) return;
    const ttsStartedAt = Date.now();
    await say(engine, text);
    if (!firstAudioAt) firstAudioAt = Date.now();
    await waitForPlayback(engine, text, ttsStartedAt, config.speech);
  };

  try {
    await streamChat({
      baseURL: openai.baseURL,
      apiKey: openai.apiKey,
      model: openai.model,
      messages,
      params: openai.params,
      signal: controller.signal,
      onDelta: async (delta) => {
        if (!firstDeltaAt) firstDeltaAt = Date.now();
        buffer += delta;
        const { sentences, rest } = takeSentences(buffer);
        buffer = rest;
        for (const sentence of sentences) {
          if (controller.signal.aborted) return;
          reply += sentence;
          await speakChunk(sentence);
        }
      },
    });

    // Whatever has no sentence break yet is the tail of the answer.
    if (buffer.trim() && !controller.signal.aborted) {
      reply += buffer;
      await speakChunk(buffer);
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error(`[migpt] failed to answer ${JSON.stringify(msg.text)}:`, error.message ?? error);
    await say(engine, "抱歉，我这边出了点问题，请稍后再说一次吧").catch(() => {});
    return;
  } finally {
    if (activeController === controller) activeController = null;
  }

  const answer = reply.trim();
  if (!answer) {
    console.warn(`[migpt] the model returned an empty answer for: ${msg.text}`);
    return;
  }
  rememberTurn("user", msg.text, maxMessages);
  rememberTurn("assistant", answer, maxMessages);
  const elapsed = Date.now() - startedAt;
  const ttft = firstDeltaAt ? firstDeltaAt - startedAt : -1;
  const firstAudio = firstAudioAt ? firstAudioAt - startedAt : -1;
  console.log(`[migpt] timings: ttft=${ttft}ms first-audio=${firstAudio}ms total=${elapsed}ms`);
  console.log(`[migpt] reply: ${answer}`);
}
