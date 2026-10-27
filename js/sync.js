// 雲端同步：Firebase Auth（Email 登入）+ Firestore 的 users/{uid} 一份文件
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.10.0';
const PUSH_DELAY = 1500;

export const syncAvailable = () => Boolean(firebaseConfig);

let fb = null;

// 第一次用到才載入 SDK，離線或沒設定時 App 照常運作
async function sdk() {
  if (fb) return fb;
  const [app, auth, store] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  const instance = app.initializeApp(firebaseConfig);
  fb = { auth, store, a: auth.getAuth(instance), db: store.getFirestore(instance) };
  return fb;
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Email 或密碼錯誤',
  'auth/wrong-password': 'Email 或密碼錯誤',
  'auth/user-not-found': '找不到這個帳號，要先註冊',
  'auth/email-already-in-use': '這個 Email 已經註冊過了，直接登入就好',
  'auth/weak-password': '密碼至少要 6 個字元',
  'auth/invalid-email': 'Email 格式不對',
  'auth/missing-password': '請輸入密碼',
  'auth/network-request-failed': '網路連線失敗',
  'auth/too-many-requests': '嘗試太多次了，等一下再試',
  'auth/operation-not-allowed': 'Firebase 還沒開啟 Email 登入',
};

export const authMessage = (err) => AUTH_ERRORS[err?.code] ?? `發生錯誤（${err?.code ?? err?.message}）`;

/**
 * handlers:
 *   onUser(user | null)                 登入狀態改變
 *   onRemote(json | null, user)         雲端資料（null 代表雲端還沒有存檔）
 *   onStatus('syncing' | 'synced' | 'offline' | 'error')
 */
export async function startSync(handlers) {
  const { auth, store, a, db } = await sdk();
  let unsubscribe = null;

  auth.onAuthStateChanged(a, (user) => {
    unsubscribe?.();
    unsubscribe = null;
    handlers.onUser(user);
    if (!user) return;
    unsubscribe = store.onSnapshot(
      store.doc(db, 'users', user.uid),
      { includeMetadataChanges: true },
      (snap) => {
        handlers.onStatus(snap.metadata.hasPendingWrites ? 'syncing' : snap.metadata.fromCache ? 'offline' : 'synced');
        // 自己剛寫入、還沒到伺服器的版本就不用再處理
        if (snap.metadata.hasPendingWrites) return;
        handlers.onRemote(snap.exists() ? snap.data().save : null, user);
      },
      () => handlers.onStatus('error'),
    );
  });
}

let pushTimer = null;
let lastPushed = null;

// 延遲一下再上傳，連續修改只寫一次；失敗就等下次修改或恢復網路再試
export function schedulePush(uid, json, mergeJson) {
  if (json === lastPushed) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow(uid, json, mergeJson).catch(() => {}), PUSH_DELAY);
}

// 在 transaction 裡讀雲端 → 合併 → 寫回，兩台同時寫也不會互相蓋掉
export async function pushNow(uid, json, mergeJson) {
  clearTimeout(pushTimer);
  if (json === lastPushed) return;
  const { store, db } = await sdk();
  const ref = store.doc(db, 'users', uid);
  lastPushed = json;
  try {
    await store.runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const save = snap.exists() ? mergeJson(snap.data().save, json) : json;
      tx.set(ref, { save, updatedAt: store.serverTimestamp() });
    });
  } catch (err) {
    lastPushed = null;
    throw err;
  }
}

// 雲端傳來的版本就是目前雲端的內容，之後內容一樣就不用再寫
export function markRemote(json) {
  lastPushed = json;
}

export async function signUp(email, password) {
  const { auth, a } = await sdk();
  return auth.createUserWithEmailAndPassword(a, email, password);
}

export async function signIn(email, password) {
  const { auth, a } = await sdk();
  return auth.signInWithEmailAndPassword(a, email, password);
}

export async function signOut() {
  const { auth, a } = await sdk();
  clearTimeout(pushTimer);
  lastPushed = null;
  return auth.signOut(a);
}

export async function resetPassword(email) {
  const { auth, a } = await sdk();
  a.languageCode = 'zh-TW';
  return auth.sendPasswordResetEmail(a, email);
}
