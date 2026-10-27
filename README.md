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

## 雲端同步（Firebase）

沒設定時 App 只存在本機；設定後設定頁會出現「帳號同步」，用 Email 登入就能在多台裝置自動同步。

1. 到 [Firebase 主控台](https://console.firebase.google.com/) 建立專案（不用開 Google Analytics）
2. **Authentication** → 開始使用 → 登入方式 → 啟用「電子郵件/密碼」
3. **Firestore Database** → 建立資料庫 → 正式版模式，位置選 `asia-east1`（台灣）
4. Firestore → **規則** → 貼上 `firestore.rules` 的內容 → 發布
5. 專案設定 → 一般 → 你的應用程式 → 新增網頁應用程式 `</>` → 把 `firebaseConfig` 貼到 `js/firebase-config.js`

同步規則：寶可夢依 ID 取聯集（同一隻取進化較多的）、圖鑑取聯集、統計取較大值、設定取最後修改的。
上傳時用 transaction 先讀雲端再合併，兩台同時寫也不會互相蓋掉。

第一次在某台裝置登入時：
- 帳號是空的 → 這台的寶可夢直接繼承到帳號
- 這台有帳號裡沒有的寶可夢 → 讓你選「合併兩邊」或「只用帳號的資料」（原本的資料會另存在 `pomomon-before-sync`）

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
- `js/store.js` localStorage 存檔、匯出匯入、備份序號、同步合併
- `js/sync.js` Firebase 登入與 Firestore 同步
- `js/firebase-config.js` Firebase 專案設定
- `firestore.rules` Firestore 安全規則（每個人只能讀寫自己的存檔）
- `scripts/build-pokedex.mjs` 從 PokéAPI 重新產生 `data/pokedex.json`
- `scripts/make-icons.mjs` 產生 App 圖示

寶可夢圖片來自 PokéAPI，版權屬於任天堂 / Game Freak，僅供個人使用。
