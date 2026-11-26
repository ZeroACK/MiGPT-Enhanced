/**
 * Phrases that are answered verbatim, before the router or the LLM is involved.
 */

/** Exact utterances mapped to the answer they get. */
export const FIXED_REPLIES = {
  你好: "你好",
  我是复读机: "我是复读机",
};

/** Said when the user greets the assistant by name. */
export const WELCOME_BACK_PHRASE = "我来了";

/** Answer to `WELCOME_BACK_PHRASE`. */
export const WELCOME_BACK_REPLY = "太好了！你终于踏马来了，想死老子了";

/**
 * Utterances that close the conversation, such as "没事了" or "退下吧".
 *
 * They are answered with {@link DISMISSIVE_REPLY} and never reach the model, so
 * calling the assistant off costs neither tokens nor latency. Matching ignores
 * the punctuation and trailing particles that speech recognition adds ("没事
 * 啦", "退下吧。"), but requires the whole utterance: "我没事" stays a normal
 * sentence that the LLM answers.
 */
const DISMISSIVE_BASES = [
  "没事",
  "没什么",
  "退下",
  "跪安",
  "不用",
  "算了",
  "不聊",
  "先这样",
  "就这样",
  "闭嘴",
  "安静",
  "别说了",
];

/** Particles that may follow a dismissal phrase without changing it. */
const TRAILING_PARTICLES = [
  "",
  "了",
  "啦",
  "吧",
  "呀",
  "啊",
  "哈",
  "嘛",
  "哦",
  "噢",
  "了啦",
  "了吧",
  "啦吧",
  "了哦",
  "了呀",
];

const DISMISSIVE_PHRASES = new Set(
  DISMISSIVE_BASES.flatMap((base) => TRAILING_PARTICLES.map((particle) => `${base}${particle}`)),
);

/** Reply spoken when the user dismisses the assistant; empty means silence. */
export const DISMISSIVE_REPLY = "好";

/**
 * Whether the utterance boils down to "never mind, stand down".
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isDismissive(text) {
  const cleaned = text.replace(/[，,。.!！?？、\s~～]/g, "");
  return DISMISSIVE_PHRASES.has(cleaned);
}
