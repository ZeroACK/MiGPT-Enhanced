/**
 * Streaming chat against an OpenAI-compatible endpoint.
 *
 * The library's `ChatBot.chat` waits for the whole answer, which delays every
 * reply by the model's full generation time. Here the answer is read as
 * server-sent events, so `src/speech.js` can start talking after the first
 * sentence.
 */

/** Characters that end a sentence and therefore make a good TTS boundary. */
const SENTENCE_BREAK = /[。！？!?；;…\n]/;

/**
 * Longest chunk handed to the TTS without punctuation. Keeps the first sound
 * from being delayed by a model that forgets to punctuate.
 */
const MAX_CHUNK_LENGTH = 80;

/** Emoji and pictographs; the TTS would read them out loud. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

/**
 * Makes raw model output suitable for the speaker: no code fences, no Markdown
 * emphasis, no emoji.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(EMOJI, "")
    .replace(/[*_#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits buffered model output into speakable sentences.
 *
 * Whatever follows the last sentence break stays in `rest` and is spoken when
 * the next delta arrives (or when the stream ends).
 *
 * @param {string} buffer
 * @returns {{ sentences: string[], rest: string }}
 */
export function takeSentences(buffer) {
  const matches = buffer.match(/[^。！？!?；;…\n]*[。！？!?；;…\n]+/g) ?? [];
  const consumed = matches.join("");
  const rest = buffer.slice(consumed.length);

  const sentences = matches.filter((sentence) => sentence.trim());

  // No punctuation for a long stretch: speak what we have instead of waiting.
  let remaining = rest;
  while ([...remaining].length > MAX_CHUNK_LENGTH) {
    const chars = [...remaining];
    sentences.push(chars.slice(0, MAX_CHUNK_LENGTH).join(""));
    remaining = chars.slice(MAX_CHUNK_LENGTH).join("");
  }

  return { sentences, rest: remaining };
}

/** Marker for the end of a stream, distinguished from an empty delta. */
const DONE = Symbol("done");

/**
 * Parses one line of an event stream.
 *
 * @param {string} line
 * @returns {string | typeof DONE | undefined}
 */
function parseLine(line) {
  if (!line || line.startsWith(":")) return undefined;
  if (!line.startsWith("data:")) return undefined;

  const payload = line.slice("data:".length).trim();
  if (!payload) return undefined;
  if (payload === "[DONE]") return DONE;

  let json;
  try {
    json = JSON.parse(payload);
  } catch {
    // A partial or non-JSON event is not worth failing the whole answer over.
    return undefined;
  }
  if (json?.error) {
    throw new Error(json.error.message ?? "the endpoint returned an error event");
  }
  const content = json?.choices?.[0]?.delta?.content;
  return typeof content === "string" && content ? content : undefined;
}

/**
 * Yields text deltas from a `text/event-stream` body.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @returns {AsyncGenerator<string>}
 */
async function* readDeltas(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        const delta = parseLine(line);
        if (delta === DONE) return;
        if (typeof delta === "string") yield delta;
      }
    }

    // Flush the decoder and any unterminated last line.
    buffer += decoder.decode();
    const delta = parseLine(buffer.trim());
    if (delta === DONE) return;
    if (typeof delta === "string") yield delta;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Fallback for endpoints that ignore `stream: true` and answer with one JSON
 * object: the answer is handed over in a single delta.
 *
 * @param {Response} response
 * @param {string} url
 * @param {(delta: string, full: string) => Promise<void> | void} onDelta
 * @returns {Promise<string>}
 */
async function readWholeAnswer(response, url, onDelta) {
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return an event stream: ${text.slice(0, 200)}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) {
    throw new Error(`${url} returned no answer: ${text.slice(0, 200)}`);
  }
  await onDelta(content, content);
  return content;
}

/**
 * Sends a streaming chat request and feeds each text delta to `onDelta`.
 *
 * `onDelta` is awaited, so a slow speaker paces the reading of the stream
 * instead of letting sentences pile up.
 *
 * @param {object} options
 * @param {string} options.baseURL OpenAI-compatible endpoint, e.g. `https://api.deepseek.com`.
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {Array<{ role: string, content: string }>} options.messages
 * @param {AbortSignal} [options.signal]
 * @param {Record<string, unknown>} [options.params] extra body fields, e.g.
 *   provider switches such as `{ thinking: { type: "disabled" } }`.
 * @param {(delta: string, full: string) => Promise<void> | void} options.onDelta
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<string>} the complete answer.
 */
export async function streamChat({
  baseURL,
  apiKey,
  model,
  messages,
  signal,
  params = {},
  onDelta,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("global fetch is not available in this Node.js version");
  }
  const url = `${String(baseURL).replace(/\/+$/, "")}/chat/completions`;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, stream: true, ...params }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} from ${url}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return readWholeAnswer(response, url, onDelta);
  }
  if (!response.body) {
    throw new Error(`${url} returned no body`);
  }

  let full = "";
  for await (const delta of readDeltas(response.body)) {
    full += delta;
    await onDelta(delta, full);
  }
  return full;
}
