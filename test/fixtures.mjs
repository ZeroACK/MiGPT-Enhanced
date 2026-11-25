/**
 * Fixtures shared by the tests.
 *
 * The device list mirrors this deployment's real Mi Home inventory, including
 * the MIoT model strings, so the vocabulary assertions exercise the same
 * model-prefix mapping the live service uses.
 */

import { buildDeviceWords, setDeviceWords } from "../src/router.js";

export const devices = [
  { name: "客厅摄像头", model: "chuangmi.camera.021a04" },
  { name: "卧室摄像头", model: "chuangmi.camera.021a04" },
  { name: "客厅电视", model: "xiaomi.tv.mih1" },
  { name: "客厅音箱", model: "xiaomi.wifispeaker.oh2p" },
  { name: "灯带", model: "xiaomi.light.bar2" },
  { name: "小爱音箱", model: "xiaomi.wifispeaker.l06a" },
  { name: "家门", model: "isa.magnet.dw2hl" },
  { name: "空调", model: "miir.aircondition.ir02" },
  { name: "手机", model: "mphone.phone.online" },
];

/**
 * Installs the fixture vocabulary (optionally with user aliases) and returns it.
 *
 * @param {string[]} [extraWords]
 * @returns {Set<string>}
 */
export function useTestVocabulary(extraWords = []) {
  const words = buildDeviceWords(devices, extraWords);
  setDeviceWords(words);
  return words;
}
