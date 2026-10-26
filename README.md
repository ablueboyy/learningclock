# 寶可夢專注鐘

番茄鐘 + 寶可夢收集（全 1025 隻）。專注完成就抽一隻，所有夥伴都會得到經驗並進化，牠們會在草地上走來走去。

## 本機執行

```sh
python3 -m http.server 8765
# 打開 http://localhost:8765/
# 測試用：http://localhost:8765/?dev   （一分鐘只算一秒）
```

## 部署到手機

通知與 PWA 需要 HTTPS，最簡單是 GitHub Pages：把整個資料夾推到 GitHub repo → Settings → Pages → 選 main 分支。

- **Android**：用 Chrome 打開 → 選單 → 「加到主畫面」
- **iPhone**：用 Safari 打開 → 分享 → 「加入主畫面」，從主畫面打開才收得到通知

## 規則

| 項目 | 設定 |
|---|---|
| 稀有度機率 | 普通 60% / 稀有 25% / 超稀有 10% / 傳說 4% / 神話 1%，異色 1% |
| 稀有度分級 | 神話＝傳說與幻之寶可夢；傳說＝準神、化石、悖謬、究極異獸等；超稀有＝御三家與強力寶可夢 |
| 草地 | 一次最多 6 隻上場 |
| 進化 | 一階 → 二階 3 次、二階 → 三階再 7 次；每次完成專注，所有夥伴 +1 |
| 備份 | 設定 → 資料備份 →「取得序號」，把序號存到手機以外的地方；換手機時「輸入序號」還原。每多 5 隻沒備份會提醒 |
| 切出 App | 每 10 分鐘專注可切出 1 次，每次最多 3 分鐘；用完或超時就算失敗 |

稀有度分級與進化次數分別在 `scripts/build-pokedex.mjs` 與 `js/pokemon.js` 調整。

## 檔案

- `js/app.js` 計時、獎勵流程、畫面
- `js/pokemon.js` 抽獎、經驗、進化
- `js/field.js` 草地上走路的動畫
- `js/notify.js` 音效、震動、通知、螢幕常亮
- `js/store.js` localStorage 存檔、匯出匯入
- `scripts/build-pokedex.mjs` 從 PokéAPI 重新產生 `data/pokedex.json`
- `scripts/make-icons.mjs` 產生 App 圖示

寶可夢圖片來自 PokéAPI，版權屬於任天堂 / Game Freak，僅供個人使用。
