/**
 * Routing: decides whether an utterance is executed natively by the speaker
 * (smart-home control or media playback) or answered by the configured LLM.
 *
 * The decision is data-driven. The vocabulary is built from the real Mi Home
 * inventory — device names plus category words derived from the MIoT model
 * strings — so "电视关机" is recognised as a device command even though the
 * device itself is named "客厅电视". Device questions ("空调为什么这么吵") still
 * go to the LLM, see `classifyRoute`.
 *
 * This module is pure: it owns the vocabulary as module state but performs no
 * I/O. `src/inventory.js` fills it from the device list.
 */

import { AhoCorasick } from "./aho.js";

/**
 * Chinese category words per MIoT model prefix. The prefix is stable across
 * firmware and account languages, while the device name is free text (and often
 * English), so both are used.
 *
 * @type {Array<[RegExp, string[]]>}
 */
const MODEL_KEYWORDS = [
  [/^xiaomi\.tv\./, ["电视"]],
  [/^(xiaomi|yeelink|philips)\.light\./, ["灯", "灯光", "灯带"]],
  [/^miir\.aircondition\./, ["空调", "冷气"]],
  [/^miir\./, ["红外遥控"]],
  [/^xiaomi\.wifispeaker\./, ["音箱", "音响", "小爱"]],
  [/^(chuangmi|mijia|isa)\.camera\./, ["摄像头", "监控"]],
  [/^isa\.(magnet|lock)\./, ["门", "窗", "门窗", "门锁"]],
  [/^mphone\./, ["手机"]],
  [/^(xiaomi|zhimi)\.airpurifier\./, ["净化器"]],
  [/^(zhimi|dmaker)\.fan\./, ["风扇", "电扇"]],
  [/^(rockrobo|roborock|dmaker\.vacuum)\./, ["扫地机", "扫地机器人"]],
  [/^(xiaomi|lumi)\.curtain\./, ["窗帘"]],
  [/^(xiaomi|cuco)\.plug\./, ["插座"]],
  [/^(xiaomi|zhimi)\.heater\./, ["暖气", "取暖器"]],
  [/^(xiaomi|zhimi)\.humidifier\./, ["加湿器"]],
  [/^(xiaomi|chunmi)\.waterheater\./, ["热水器"]],
];

/**
 * Vocabulary used when the device list cannot be fetched, so that a login or
 * network hiccup does not turn every device command into an LLM answer.
 *
 * @type {readonly string[]}
 */
const FALLBACK_DEVICE_WORDS = [
  "灯",
  "灯光",
  "窗帘",
  "空调",
  "风扇",
  "电视",
  "投影",
  "插座",
  "热水器",
  "加湿器",
  "净化器",
  "扫地机",
  "音箱",
  "暖气",
  "门锁",
  "摄像头",
  "音量",
  "声音",
  "亮度",
];

/**
 * Verbs that indicate the user wants something changed on a device.
 *
 * @type {readonly string[]}
 */
const DEVICE_CONTROL_VERBS = [
  "打开",
  "关闭",
  "开启",
  "关掉",
  "开一下",
  "关一下",
  "开机",
  "关机",
  "启动",
  "停止",
  "暂停",
  "继续",
  "恢复",
  "调到",
  "调成",
  "调高",
  "调低",
  "调大",
  "调小",
  "设置",
  "设为",
  "切换到",
  "静音",
  "取消静音",
  "定时",
  "取消定时",
  "倒计时",
  "拉开",
  "拉上",
  "收起",
  "放下",
  "调亮",
  "调暗",
  "开",
  "关",
];

/** Single-scan matcher for the control verbs, see `src/aho.js`. */
const VERB_MATCHER = new AhoCorasick(DEVICE_CONTROL_VERBS);

/** Polite openers stripped before looking for a command verb. */
const POLITE_PREFIX = /^(请|麻烦)?(帮我|给我|我要|我想|来)?/;

/**
 * The speaker's own media commands. These never reach a device in the Mi Home
 * list, so they are matched without a device name.
 *
 * @type {readonly string[]}
 */
const MEDIA_COMMANDS = [
  "播放",
  "暂停",
  "继续",
  "停止",
  "下一首",
  "上一首",
  "切歌",
  "单曲循环",
  "随机播放",
  "放首歌",
  "放音乐",
  "放点音乐",
  "放一首",
  "放个",
  "听歌",
  "听音乐",
  "听广播",
  "听新闻",
  "唱歌",
  "静音",
  "取消静音",
  "音量",
  "声音",
  "大声点",
  "小声点",
];

/** Matcher for media commands, used as an anchored prefix check. */
const MEDIA_MATCHER = new AhoCorasick(MEDIA_COMMANDS);

/**
 * Verb prefixes that are specific enough to be a command on their own.
 *
 * @type {readonly string[]}
 */
const STRONG_VERB_PREFIXES = [
  "打开",
  "关闭",
  "开启",
  "关掉",
  "开机",
  "关机",
  "调到",
  "调成",
  "调高",
  "调低",
  "调大",
  "调小",
  "切换到",
  "静音",
  "取消静音",
  "音量",
  "声音",
  "播放",
  "暂停",
  "下一首",
  "上一首",
];

/** Matcher for the strong verb prefixes, used as an anchored prefix check. */
const STRONG_VERB_MATCHER = new AhoCorasick(STRONG_VERB_PREFIXES);

/**
 * Interrogatives that ask for information rather than for an action. They win
 * over the device rules: "怎么关空调" is a question, "把空调关掉" is a command.
 *
 * @type {readonly string[]}
 */
const INFO_QUESTION_WORDS = [
  "为什么",
  "为啥",
  "怎么",
  "如何",
  "是什么",
  "啥",
  "谁",
  "哪里",
  "哪个",
  "在哪",
  "多少钱",
  "几点",
  "几号",
  "多久",
  "什么时候",
];

/** Single-scan matcher for the informational interrogatives. */
const INFO_QUESTION_MATCHER = new AhoCorasick(INFO_QUESTION_WORDS);

/**
 * Words that make a sentence a question, whether or not it asks for action.
 *
 * @type {readonly string[]}
 */
const QUESTION_WORDS = ["吗", "呢", "多少", "几个", "是不是", "有没有"];

/** Single-scan matcher for the plain question words. */
const QUESTION_MATCHER = new AhoCorasick(QUESTION_WORDS);

/**
 * Device vocabulary currently in use.
 *
 * @type {Set<string>}
 */
let deviceWords = new Set(FALLBACK_DEVICE_WORDS);

/** Single-scan matcher for the device vocabulary, rebuilt on every refresh. */
let deviceMatcher = new AhoCorasick(FALLBACK_DEVICE_WORDS);

/**
 * Builds the vocabulary from a MIoT device list.
 *
 * @param {Array<{ name?: string, model?: string }>} devices
 * @param {readonly string[]} [extraWords] user supplied aliases.
 * @returns {Set<string>}
 */
export function buildDeviceWords(devices, extraWords = []) {
  const words = new Set();
  for (const device of devices ?? []) {
    const name = (device.name ?? "").trim().toLowerCase();
    if (name) {
      words.add(name);
      // Split mixed names such as "客厅电视" into their parts.
      for (const part of name.split(/[^0-9a-z\u4e00-\u9fa5]+/)) {
        if (part.length >= 2) words.add(part);
      }
    }
    const model = (device.model ?? "").trim().toLowerCase();
    for (const [pattern, keywords] of MODEL_KEYWORDS) {
      if (pattern.test(model)) for (const word of keywords) words.add(word);
    }
  }
  for (const word of extraWords) {
    const normalized = String(word ?? "").trim().toLowerCase();
    if (normalized) words.add(normalized);
  }
  return words;
}

/**
 * Replaces the routing vocabulary, e.g. after a refresh or in tests.
 *
 * @param {Iterable<string>} words
 * @returns {void}
 */
export function setDeviceWords(words) {
  deviceWords = new Set(words);
  deviceMatcher = new AhoCorasick(deviceWords);
}

/**
 * Returns the device vocabulary currently in use.
 *
 * @returns {Set<string>}
 */
export function getDeviceWords() {
  return new Set(deviceWords);
}

/**
 * Returns the device word mentioned in the utterance, if any.
 *
 * The automaton stops at the first word that completes ("打开客厅灯" stops at
 * "灯"), so the scan length is the utterance length, not the vocabulary size.
 *
 * @param {string} text
 * @returns {string | undefined}
 */
function findDeviceWord(text) {
  return deviceMatcher.matchFirst(text.toLowerCase())?.pattern;
}

/**
 * Returns true when the utterance is one of the speaker's own media commands.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isMediaCommand(text) {
  const stripped = text.replace(POLITE_PREFIX, "");
  return MEDIA_MATCHER.matchPrefix(stripped) !== undefined;
}

/**
 * Leading wake phrase.
 *
 * The speaker logs the wake phrase itself as an utterance ("小爱同学"), and the
 * routing vocabulary contains "小爱" as a speaker alias, so without this guard
 * every wake-up would be answered as a conversation.
 *
 * The lookahead requires the wake word to stand alone or be followed by
 * punctuation: "小爱是什么" keeps its subject and is still answered as a
 * question, while "小爱同学，今天几号" keeps only the actual request.
 */
const WAKE_WORD_PREFIX = /^(?:喂|嗨|哎)?[，,、\s]*(?:小爱同学|小爱小爱|小爱)(?=[，,。.!！?？、\s]|$)/;

/** Punctuation left over after the wake phrase, e.g. the comma in "小爱同学，…". */
const WAKE_WORD_TRAILING = /^[，,。.!！?？、\s]+/;

/**
 * Removes a leading wake phrase.
 *
 * @param {string} text
 * @returns {string} the remaining request, or `""` when the utterance was only
 *   the wake phrase.
 */
export function stripWakeWord(text) {
  if (!WAKE_WORD_PREFIX.test(text)) return text;
  return text.replace(WAKE_WORD_PREFIX, "").replace(WAKE_WORD_TRAILING, "").trim();
}

/**
 * Decides who should answer an utterance.
 *
 * - `native` — the speaker can do it itself (device control or media), so
 *   MiGPT stays silent.
 * - `llm` — anything else, including questions about devices.
 *
 * A device word alone is not enough: "空调为什么这么吵" mentions a device but
 * asks a question, so the LLM answers it.
 *
 * @param {string} text
 * @returns {{ handledBy: "native" | "llm", reason: string }}
 */
export function classifyRoute(text) {
  if (isMediaCommand(text)) {
    return { handledBy: "native", reason: "media command" };
  }

  // "怎么关空调" mentions a device and a verb, but asks for instructions.
  if (INFO_QUESTION_MATCHER.has(text)) {
    return { handledBy: "llm", reason: "informational question" };
  }

  const deviceWord = findDeviceWord(text);
  if (deviceWord) {
    if (VERB_MATCHER.has(text)) {
      return { handledBy: "native", reason: `device "${deviceWord}"` };
    }
    return { handledBy: "llm", reason: `device "${deviceWord}" without a command verb` };
  }

  if (QUESTION_MATCHER.has(text)) {
    return { handledBy: "llm", reason: "question" };
  }

  const stripped = text.replace(POLITE_PREFIX, "");
  if (STRONG_VERB_MATCHER.matchPrefix(stripped) !== undefined && stripped.length <= 12) {
    return { handledBy: "native", reason: "bare device command" };
  }

  return { handledBy: "llm", reason: "conversation" };
}
