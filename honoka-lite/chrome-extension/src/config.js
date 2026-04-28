// Configuration module to manage dynamic settings

const isLiteVersion = chrome.runtime.getManifest().name.includes('Lite');
const BRIDGE_PORT = isLiteVersion ? 44124 : 7749;

export const Config = {
  BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
  isLiteVersion: isLiteVersion
};
