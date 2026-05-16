const { getEffectiveSettings } = require("../settings");

const ANYTYPE_DEFAULT_URL = "http://127.0.0.1:31009";
const ANYTYPE_VERSION = "2025-11-08";

/**
 * 將文章存到 Anytype 指定的 Collection
 *
 * @param {Object} params
 * @param {string} params.title      - 文章標題
 * @param {string} params.markdown   - Markdown 內容
 * @param {string} params.url        - 原始 URL
 * @param {string} params.category   - 分類 (real-estate, article, etc.)
 * @param {Object} [params.properties] - 額外屬性 (price, ping, floor, layout...)
 * @returns {Promise<{ok: boolean, objectId?: string, error?: string}>}
 */
async function saveToAnytype({ title, markdown, url, category, properties }) {
  const settings = getEffectiveSettings();

  // 如果沒有設定 Anytype，靜默跳過（不影響現有流程）
  if (!settings.anytypeApiKey || !settings.anytypeSpaceId) {
    return { ok: false, error: "Anytype not configured" };
  }

  const axios = require("axios");

  const baseUrl = settings.anytypeApiUrl || ANYTYPE_DEFAULT_URL;
  const headers = {
    "Authorization": `Bearer ${settings.anytypeApiKey}`,
    "Anytype-Version": ANYTYPE_VERSION,
    "Content-Type": "application/json",
  };

  try {
    // 1. 建立 Object
    const createPayload = {
      name: title,
      type_key: resolveObjectType(category),
      body: markdown,
    };

    // 如果有 URL，加入 source 屬性（經測試 properties 陣列格式需配合 Anytype 的 relation link 規範）
    // 目前 properties 格式待確認，先以 source URL 內嵌在 body 中

    const createResp = await axios.post(
      `${baseUrl}/v1/spaces/${settings.anytypeSpaceId}/objects`,
      createPayload,
      { headers, timeout: 10000 }
    );

    const objectId = createResp.data?.object?.id;

    if (!objectId) {
      console.error("[Anytype] Create succeeded but no object ID returned");
      return { ok: false, error: "No object ID in response" };
    }

    console.log(`[Anytype] Object created: ${objectId}`);

    // 2. 加入到對應的 Collection（如果有設定）
    const collectionId = resolveCollection(category, settings);
    if (collectionId) {
      try {
        await axios.post(
          `${baseUrl}/v1/spaces/${settings.anytypeSpaceId}/lists/${collectionId}/objects`,
          [objectId],
          { headers, timeout: 5000 }
        );
        console.log(`[Anytype] Added to collection: ${collectionId}`);
      } catch (listErr) {
        // 加入 Collection 失敗不影響物件已建立的事實
        console.error(`[Anytype] Failed to add to collection ${collectionId}:`, listErr.message);
      }
    }

    return { ok: true, objectId };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error("[Anytype] Save failed:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * 根據文章分類對應到 Anytype Object Type
 * 預設回傳 "note"
 */
function resolveObjectType(category) {
  const typeMap = {
    "real-estate": "note",
    "article": "note",
    "bookmark": "bookmark",
    "video": "note",
  };
  return typeMap[category] || "note";
}

/**
 * 根據文章分類對應到 Anytype Collection ID
 * 設定格式：settings.anytypeCollections = { "real-estate": "id1", "article": "id2", ... }
 */
function resolveCollection(category, settings) {
  const collections = settings.anytypeCollections || {};
  return collections[category] || collections["default"] || null;
}

/**
 * 將 Honoka properties 對應到 Anytype Object 的屬性格式
 * 回傳格式為 { relationKey: value } 的 flat object
 */
function mapProperties(properties, category) {
  if (!properties) return {};

  const mapped = {};
  if (properties.price) mapped.price = properties.price;
  if (properties.ping) mapped.area = properties.ping;
  if (properties.floor) mapped.floor = properties.floor;
  if (properties.layout) mapped.layout = properties.layout;
  if (properties.community) mapped.community = properties.community;
  if (properties.address) mapped.address = properties.address;
  return mapped;
}

module.exports = { saveToAnytype, resolveCollection, mapProperties, resolveObjectType };
