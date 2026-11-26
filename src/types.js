/**
 * Shared JSDoc types.
 *
 * Every module names the engine and the message through these aliases, so no
 * private class of `@mi-gpt/next` has to be imported and the `onMessage`
 * signature stays in one place.
 *
 * The `export {}` keeps this file a module, which is what makes the typedefs
 * importable via `import("./types.js").Engine`.
 */

/** @typedef {import("@mi-gpt/next").MiGPTConfig} MiGPTConfig */

/** @typedef {Parameters<NonNullable<MiGPTConfig["onMessage"]>>} OnMessageArgs */

/** @typedef {OnMessageArgs[0]} Engine */

/** @typedef {OnMessageArgs[1]} Message */

/**
 * The parsed `config.json`: the library config plus the fields this project
 * adds.
 *
 * - `extraDeviceWords` — extra spoken aliases for the routing vocabulary.
 * - `bargeInText` — filler played to interrupt Xiaoai's native answer; empty or
 *   missing disables the barge-in.
 * - `dismissiveReply` — reply to a dismissal ("没事了", "退下吧"); empty keeps
 *   the speaker silent. Dismissals are never sent to the model.
 * - `promptFile` — path of the prompt template, relative to `config.json`.
 * - `promptTemplate` — the loaded template, filled in by `main.js`.
 * - `speech` — tuning of the playback pacing used while streaming.
 * - `openai.params` — extra fields merged into the request body.
 * - `context.historyTurns` — how many exchanges are kept and sent.
 * - `context.vars` — extra placeholders available to the prompt template.
 *
 * @typedef {MiGPTConfig & {
 *   extraDeviceWords?: string[],
 *   bargeInText?: string,
  dismissiveReply?: string,
 *   promptFile?: string,
 *   promptTemplate?: { path: string, template: string },
 *   speech?: { leadUpMs?: number, msPerChar?: number },
 *   openai?: { baseURL?: string, apiKey?: string, model?: string, params?: Record<string, unknown> },
 *   context?: { historyTurns?: number, vars?: Record<string, string> },
 * }} AppConfig
 */

export {};
