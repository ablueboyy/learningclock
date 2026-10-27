// Firebase 專案設定（Firebase 主控台 → 專案設定 → 你的應用程式 → SDK 設定）
// 留 null 就不啟用同步，App 照常只存在這台裝置。
// 這些值本來就會公開在網頁裡，資料安全靠 firestore.rules 保護。
export const firebaseConfig = {
  apiKey: 'AIzaSyA_63eTZv4k6i3ePzLxM9ZvF-a26SLzb7g',
  authDomain: 'pokemonclock-ff192.firebaseapp.com',
  projectId: 'pokemonclock-ff192',
  storageBucket: 'pokemonclock-ff192.firebasestorage.app',
  messagingSenderId: '740620361303',
  appId: '1:740620361303:web:8dee16b526ff4b621c8d12',
};
