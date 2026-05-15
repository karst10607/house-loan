// Site-specific extraction rules for property websites
const SITE_RULES = {
  "sale.591.com.tw": {
    name: "591 售屋網",
    priceSelector: ".house-price .price",
    extract: (html, window) => {
      // 591 hides data in dataLayer or INITIAL_STATE
      const dataLayerMatch = html.match(/window\.dataLayer\s*=\s*window\.dataLayer\s*\|\|\s*\[\];\s*window\.dataLayer\.push\((\{.*?\})\)/);
      const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/);
      let data = {};
      if (initialStateMatch) try { data = JSON.parse(initialStateMatch[1]); } catch(e){}
      if (dataLayerMatch) try { Object.assign(data, JSON.parse(dataLayerMatch[1])); } catch(e){}

      return {
        price: data.price_name || data.price || "",
        ping: data.area_name || data.area || "",
        floor: data.floor_name || data.floor || "",
        layout: data.layout_name || data.layout || "",
        address: data.address || "",
        community: data.community_name || ""
      };
    }
  },
  "buy.yungching.com.tw": {
    name: "永慶房仲網",
    extract: (html, window) => {
      const dataLayerMatch = html.match(/window\.dataLayer\s*=\s*\[(\{.*?\})\]/);
      let data = {};
      if (dataLayerMatch) try { data = JSON.parse(dataLayerMatch[1]); } catch(e){}
      return {
        price: data.price || "",
        ping: data.area || "",
        floor: data.floor || "",
        layout: data.layout || "",
        address: data.address || ""
      };
    }
  },
  "www.great-home.com.tw": {
    name: "大家房屋",
    extract: (html, window) => {
      // Basic extraction for now
      return {
        price: window.document.querySelector(".price")?.textContent?.trim() || ""
      };
    }
  }
};

module.exports = SITE_RULES;
