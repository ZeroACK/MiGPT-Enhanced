/**
 * Console hygiene.
 *
 * The speaker library and the Xiaomi login helpers write Chinese status lines
 * decorated with emoji (`✅`, `❌`). The service runs under systemd, where a
 * plain, English, ASCII-only journal is easier to grep and forward, so the entry
 * point installs a filter that removes pictographs from every console call.
 *
 * Only the decoration is removed; the text itself (including Chinese words that
 * come from the library) is kept, because those messages carry the actual error.
 */

/** Emoji, variation selectors and zero-width joiners. */
const PICTOGRAPHS = /\p{Extended_Pictographic}|\uFE0F|\u200D/gu;

/** Consoles already wrapped, so repeated calls cannot wrap one twice. */
const wrapped = new WeakSet();

/**
 * Removes pictographs from one value, leaving other types untouched.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function stripPictographs(value) {
  if (typeof value !== "string") return value;
  return value.replace(PICTOGRAPHS, "").replace(/[ \t]{2,}/g, " ").trimStart();
}

/**
 * Replaces `console.log`/`info`/`warn`/`error` with pictograph-free versions.
 *
 * @param {Pick<Console, "log" | "info" | "warn" | "error">} [target] console to
 *   wrap, injectable for tests.
 * @returns {void}
 */
export function installLogFilter(target = console) {
  if (wrapped.has(target)) return;
  wrapped.add(target);
  for (const method of ["log", "info", "warn", "error"]) {
    const original = target[method].bind(target);
    target[method] = (...args) => original(...args.map(stripPictographs));
  }
}
