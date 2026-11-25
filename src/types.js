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

/** @typedef {MiGPTConfig & { extraDeviceWords?: string[] }} AppConfig */

export {};
