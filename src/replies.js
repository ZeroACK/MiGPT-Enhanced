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
