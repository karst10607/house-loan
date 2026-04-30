下面給你兩個部分：

1. **文章 + 圖片 + OCR/caption pipeline 圖**
2. **用你這兩篇實際示範 `article_id`、`image_id`、`vision_caption` 欄位**

我直接用 **可複製的 Markdown** 給你。

---

```md
# 附錄：文章 + 圖片 + OCR/Caption Pipeline 與案例欄位示範

## 一、Pipeline 圖

```text
[原始資料來源]
  ├─ article folder / index.md
  ├─ front matter
  ├─ markdown 正文
  └─ 文章內圖片 URL / assets
          │
          ▼
[Step 1: 文件解析]
  ├─ 讀 front matter
  ├─ 讀正文
  ├─ 抽出所有圖片 URL
  ├─ 抽出圖片附近段落
  └─ 產生 article_id
          │
          ▼
[Step 2: 圖片資產建模]
  ├─ 為每張圖建立 image_id
  ├─ 建立 article_id ↔ image_id mapping
  ├─ 記錄 position / role / image_url
  └─ 可選：下載圖片到 local_path
          │
          ▼
[Step 3: 圖片語意前處理]
  ├─ OCR：抽圖中文字
  ├─ Vision Caption：產生圖片描述
  ├─ Tags：人物 / 車型 / 顏色 / 場景
  ├─ Nearby Text：保留圖片附近原文
  └─ 可選：做人名 / 車型 / 品牌抽取
          │
          ▼
[Step 4: 索引資料生成]
  ├─ 文章文件 article docs
  ├─ 圖片文件 image docs
  ├─ manifest.jsonl
  ├─ 把 OCR / caption / nearby_text 寫入 image docs
  └─ 把 image_ids 寫回 article docs
          │
          ▼
[Step 5: Embedding / Vector DB]
  ├─ article 正文 embedding
  ├─ image 語意文字 embedding
  ├─ 可選：image embedding
  └─ 存 metadata:
      - article_id
      - image_id
      - title
      - url
      - saved_at
      - image_url
          │
          ▼
[Step 6: AnythingLLM / RAG 查詢]
  ├─ 問文章 → 找 article docs
  ├─ 問圖片內容 → 找 image docs
  ├─ 圖片命中後回 article_id
  ├─ 文章命中後帶出 image_ids
  └─ 回答時附對應圖片 URL / metadata
```

---

## 二、查詢流程示意

### 2.1 問文章找圖片

```text
使用者問題：
  「那篇 CFMOTO PAPIO 有圖片嗎？」

流程：
  1. 先命中 article doc
  2. 取 article_id = article_20260429_cfmoto_papio
  3. 查 image docs where article_doc_id = article_20260429_cfmoto_papio
  4. 回主圖 + 配色圖 + 文章摘要
```

---

### 2.2 問圖片內容找文章

```text
使用者問題：
  「找藍白配色的小型仿賽機車那篇」

流程：
  1. 先搜 image docs 的 vision_caption / tags / OCR
  2. 命中 img_papio_01
  3. 取 article_doc_id = article_20260429_cfmoto_papio
  4. 回原文章 + 對應圖片
```

---

### 2.3 問人物照片找文章

```text
使用者問題：
  「找壇蜜穿綠色洋裝的那篇」

流程：
  1. 搜 image docs 的 caption / tags
  2. 命中 img_danmitsu_02 ~ img_danmitsu_06
  3. 回 article_20260428_danmitsu
  4. 附主圖或最相關幾張圖
```

---

## 三、案例一：壇蜜文章實際示範

### 3.1 Article Metadata 範例

```yaml
---
doc_id: "article_20260428_danmitsu"
title: "【 壇蜜 】休養から復帰後 久々に公の場に登場 〝遺体衛生保全士〟資格取得のキッカケ明かす 「命は1個しかない」"
source: "telegram"
category: "reference"
url: "https://share.google/PYQd4jMdT5Ks8ub0w"
saved_at: "2026-04-28T15:24:36.137Z"
lang: "ja"
content_type: "article"
topic:
  - "entertainment"
  - "person"
  - "event"
  - "danmitsu"
image_ids:
  - "img_danmitsu_01"
  - "img_danmitsu_02"
  - "img_danmitsu_03"
  - "img_danmitsu_04"
  - "img_danmitsu_05"
  - "img_danmitsu_06"
  - "img_danmitsu_07"
  - "img_danmitsu_08"
---
```

---

### 3.2 圖片清單與建議欄位

#### img_danmitsu_01

```yaml
---
image_id: "img_danmitsu_01"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/9/2/680mw/img_92d70f54ab4097acb3c3e2fb7905b63d108618.jpg"
position: 1
role: "hero"
alt_text: "【 壇蜜 】休養から復帰後 久々に公の場に登場　〝遺体衛生保全士〟資格取得のキッカケ明かす　「命は1個しかない」|TBS NEWS DIG"
nearby_text: "タレント・俳優の壇蜜さんが映画『旅立ちのラストダンス』公開記念特別トークショー付先行上映会に登壇しました。"
ocr_text: ""
vision_caption: "壇蜜的活動主視覺照片，與電影公開紀念特別活動相關。"
tags:
  - "壇蜜"
  - "映画イベント"
  - "トークショー"
---
```

#### img_danmitsu_02

```yaml
---
image_id: "img_danmitsu_02"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/7/c/680mw/img_7c583d2f2ffb35bfb8c596df80bb19cf154198.jpg"
position: 2
role: "gallery"
alt_text: ""
nearby_text: "体調不良から一時休養し、2023年に復帰した壇蜜さんは久々に公の場に登場。深いグリーン色のワンピースをまとい、かなりほっそりした印象の壇蜜さんは..."
ocr_text: ""
vision_caption: "壇蜜站在活動現場，穿深綠色洋裝，面向觀眾或媒體。"
tags:
  - "壇蜜"
  - "深綠色洋裝"
  - "活動現場"
  - "公開露面"
---
```

#### img_danmitsu_03

```yaml
---
image_id: "img_danmitsu_03"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/6/2/680mw/img_629dab9047e6a74b9cfd4d488c570029149586.jpg"
position: 3
role: "gallery"
alt_text: ""
nearby_text: "本作は、香港映画歴代最高興行収入記録を樹立した話題作。「家族」「伝統」「死生観」という普遍的なテーマを丁寧に描き..."
ocr_text: ""
vision_caption: "壇蜜在活動中的近景照片，與電影《旅立ちのラストダンス》宣傳活動相關。"
tags:
  - "壇蜜"
  - "映画"
  - "イベント"
---
```

#### img_danmitsu_04

```yaml
---
image_id: "img_danmitsu_04"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/b/f/680mw/img_bf76aec9c19def441d4224f8d650e9e3183666.jpg"
position: 4
role: "gallery"
alt_text: ""
nearby_text: ""
ocr_text: ""
vision_caption: "壇蜜於舞台活動中的另一張照片，可能為不同角度或姿勢。"
tags:
  - "壇蜜"
  - "舞台"
  - "活動照片"
---
```

#### img_danmitsu_05

```yaml
---
image_id: "img_danmitsu_05"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/7/3/680mw/img_73edfec0c3d4cc2fa32a7520ff999fbb207794.jpg"
position: 5
role: "gallery"
alt_text: ""
nearby_text: "「遺体衛生保全士」の資格を持つ壇蜜さんは、取得のきっかけについて..."
ocr_text: ""
vision_caption: "壇蜜於活動中發言或受訪的照片，與遺體衛生保全士資格話題相關。"
tags:
  - "壇蜜"
  - "発言"
  - "資格"
  - "遺体衛生保全士"
---
```

#### img_danmitsu_06

```yaml
---
image_id: "img_danmitsu_06"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/8/7/680mw/img_87966cac72d4ca40baa445832a227c68154893.jpg"
position: 6
role: "gallery"
alt_text: ""
nearby_text: "本作の中で、リアリティを感じた描写について問われると..."
ocr_text: ""
vision_caption: "壇蜜在活動現場的近照，與她談論作品真實感的內容相鄰。"
tags:
  - "壇蜜"
  - "映画トーク"
  - "近照"
---
```

#### img_danmitsu_07

```yaml
---
image_id: "img_danmitsu_07"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/3/7/680mw/img_3714ebc638672287cd030616ba7e1ceb148875.jpg"
position: 7
role: "gallery"
alt_text: ""
nearby_text: "また、夫で漫画家の清野とおるさんによる、壇蜜さんとの日常を描いた『壇蜜』がマンガ大賞2026において2位を受賞したことについて触れられると..."
ocr_text: ""
vision_caption: "壇蜜在活動現場的照片，對談內容延伸到清野とおる與漫畫《壇蜜》。"
tags:
  - "壇蜜"
  - "清野とおる"
  - "マンガ大賞"
---
```

#### img_danmitsu_08

```yaml
---
image_id: "img_danmitsu_08"
article_doc_id: "article_20260428_danmitsu"
image_url: "https://newsdig.ismcdn.jp/mwimgs/0/4/680mw/img_04feb1c1e9d6fea998d7a4b4353b27ab210507.jpg"
position: 8
role: "closing"
alt_text: ""
nearby_text: ""
ocr_text: ""
vision_caption: "壇蜜活動照片的收尾圖，可能為舞台上的另一個角度。"
tags:
  - "壇蜜"
  - "活動照片"
---
```

---

## 四、案例二：CFMOTO PAPIO 文章實際示範

### 4.1 Article Metadata 範例

```yaml
---
doc_id: "article_20260429_cfmoto_papio"
title: "【新車】ミニ耐久レーサー！？新型125「PAPIO XO-1 R RACER」登場！ CFMOTOのミニバイクがフルカウルに 価格は40万1500円から"
source: "telegram"
category: "reference"
url: "https://share.google/Q5IWnwSVdlHH9RZ3J"
saved_at: "2026-04-29T10:39:01.137Z"
lang: "ja"
content_type: "article"
topic:
  - "motorcycle"
  - "cfmoto"
  - "125cc"
  - "new-model"
  - "papio"
image_ids:
  - "img_papio_01"
  - "img_papio_02"
  - "img_papio_03"
  - "img_papio_04"
  - "img_papio_05"
  - "img_papio_06"
  - "img_papio_07"
  - "img_papio_08"
---
```

---

### 4.2 圖片清單與建議欄位

#### img_papio_01

```yaml
---
image_id: "img_papio_01"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://img.webike-cdn.net/@news/wp-content/uploads/2026/04/re-img69c08ed4096d8_08_2026-04-28-12-26-30.jpg"
position: 1
role: "hero"
alt_text: ""
nearby_text: "CFMOTOは、クラシックカフェレーサーのエッセンスを現代的に再解釈した125ccモデル「PAPIO XO-1 R RACER」の国内発売をアナウンスした。"
ocr_text: "CFMOTO"
vision_caption: "藍白配色的小型仿賽風機車主視覺圖，帶雙頭燈與全整流罩。"
tags:
  - "CFMOTO"
  - "PAPIO XO-1 R RACER"
  - "藍白配色"
  - "125cc"
  - "フルカウル"
---
```

#### img_papio_02

```yaml
---
image_id: "img_papio_02"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://img.webike-cdn.net/@news/wp-content/uploads/2026/04/img68fb2c75436e7.jpg"
position: 2
role: "gallery"
alt_text: ""
nearby_text: "「PAPIO XO-1」は、クラシックカフェレーサーの持つ雰囲気を現代の感性で蘇らせた、ユニークなミニスポーツモデル。"
ocr_text: ""
vision_caption: "PAPIO XO-1 R RACER 的車身展示圖，強調 neo cafe racer 風格。"
tags:
  - "PAPIO"
  - "cafe racer"
  - "ミニスポーツ"
---
```

#### img_papio_03

```yaml
---
image_id: "img_papio_03"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://img.webike-cdn.net/@news/wp-content/uploads/2026/04/img69c092c30666b.jpg"
position: 3
role: "gallery"
alt_text: ""
nearby_text: "PAPIO XO-1 R RACERには、コンパクトな車体に合わせて最適化された車種専用フレームを採用。"
ocr_text: ""
vision_caption: "PAPIO XO-1 R RACER 的另一張展示圖，可能與車架或整體側面造型有關。"
tags:
  - "車架"
  - "PAPIO"
  - "側面圖"
---
```

#### img_papio_04

```yaml
---
image_id: "img_papio_04"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://img.webike-cdn.net/@news/wp-content/uploads/2026/04/re-img68fb2d7ae87be_2026-04-28-12-22-11.jpg"
position: 4
role: "detail"
alt_text: ""
nearby_text: "足回りには、フロントに剛性に優れた倒立フォーク、リアにはモノショックサスペンションを採用。"
ocr_text: ""
vision_caption: "車輛細節或底盤相關展示圖，與倒立前叉、後單槍避震等說明相鄰。"
tags:
  - "倒立フォーク"
  - "サスペンション"
  - "足回り"
---
```

#### img_papio_05

```yaml
---
image_id: "img_papio_05"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://img.webike-cdn.net/@news/wp-content/uploads/2026/04/re-img69b3ac3420f82_2026-04-28-12-21-44.jpg"
position: 5
role: "color-variant"
alt_text: ""
nearby_text: "PAPIO XO-1 R RACER（2026）チャンピオンブルー"
ocr_text: ""
vision_caption: "PAPIO XO-1 R RACER 2026 年式 Champion Blue 配色圖。"
tags:
  - "Champion Blue"
  - "藍色"
  - "配色圖"
---
```

#### img_papio_06

```yaml
---
image_id: "img_papio_06"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://img.webike-cdn.net/@news/wp-content/uploads/2026/04/re-img69b3ac4759de2-1_2026-04-28-12-21-59.jpg"
position: 6
role: "color-variant"
alt_text: ""
nearby_text: "PAPIO XO-1 R RACER（2026）ネビュラホワイト"
ocr_text: ""
vision_caption: "PAPIO XO-1 R RACER 2026 年式 Nebula White 配色圖。"
tags:
  - "Nebula White"
  - "白色"
  - "配色圖"
---
```

#### img_papio_07

```yaml
---
image_id: "img_papio_07"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://img.webike-cdn.net/@news/wp-content/uploads/2026/04/re-img69b3ac50dfc57_2026-04-28-12-22-03.jpg"
position: 7
role: "color-variant"
alt_text: ""
nearby_text: "PAPIO XO-1 R RACER（2026）デザートカーキ"
ocr_text: ""
vision_caption: "PAPIO XO-1 R RACER 2026 年式 Desert Khaki 配色圖。"
tags:
  - "Desert Khaki"
  - "卡其色"
  - "配色圖"
---
```

#### img_papio_08

```yaml
---
image_id: "img_papio_08"
article_doc_id: "article_20260429_cfmoto_papio"
image_url: "https://share.google/wp-content/uploads/2021/12/pv_icon.svg"
position: 0
role: "ui-noise"
alt_text: ""
nearby_text: "6時間前 / 1,300 / 0"
ocr_text: ""
vision_caption: "網站介面圖示，非文章主內容圖片。"
tags:
  - "ui"
  - "noise"
  - "ignore"
---
```

> 註：像 `pv_icon.svg`、`like.svg` 這種 UI 元件應在 pipeline 中標記為 `ui-noise` 或直接排除，不建議納入正式圖片資產。

---

## 五、圖片過濾規則建議

### 5.1 建議保留
- JPG / PNG 主圖
- gallery 圖
- 車色圖
- 文章人物照片
- 與正文相鄰且有主題意義的圖片

### 5.2 建議排除
- SVG icon
- like / view / share UI 圖示
- favicon
- 廣告像素
- 純裝飾按鈕圖

### 5.3 判斷條件示例
```text
若 image_url 包含：
- /svg/
- like.svg
- pv_icon.svg
- icon
- logo（視情況）
則標記為 ui-noise 或略過
```

---

## 六、實作時的最小欄位集合

### 6.1 文章最小欄位
- `doc_id`
- `title`
- `url`
- `saved_at`
- `content`
- `image_ids`

### 6.2 圖片最小欄位
- `image_id`
- `article_doc_id`
- `image_url`
- `position`
- `role`
- `vision_caption`
- `nearby_text`

### 6.3 若要提升搜尋品質，再補
- `ocr_text`
- `tags`
- `local_path`
- `embedding`
- `width` / `height`
- `mime_type`

---

## 七、建議的下一步

### 第一步
先把你現有文章做成：
- `article_id`
- `image_id`
- `article-image mapping`

### 第二步
先不做最重的 image embedding，
而是先做：
- `vision_caption`
- `ocr_text`
- `nearby_text`

### 第三步
把 article docs 與 image docs 一起丟進向量資料庫，
讓搜尋可同時命中文章與圖片語意。

### 第四步
回答時：
- 若命中文章，就附相關圖片
- 若命中圖片，就反查原文章並一起吐出
```

---

如果你要，我下一步還可以直接幫你再補一份：

1. **`image_docs.md` 格式範本**
2. **`manifest.jsonl` 實際輸出範例**
3. **圖片抽取與過濾規則 pseudo code**  

你如果要，我可以直接接著做成**可落地匯入的格式**。
