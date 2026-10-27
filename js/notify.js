// 提醒：音效、震動、系統通知、螢幕常亮

let ctx = null;

// 手機瀏覽器規定音效要在使用者點擊後才能啟用
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!ctx && AC) ctx = new AC();
  ctx?.resume?.();
}

const TUNES = {
  done: [523, 659, 784, 1047],
  break: [784, 659, 523, 659],
  fail: [392, 330, 262],
};

export function chime(kind) {
  if (!ctx) return;
  const notes = TUNES[kind];
  const start = ctx.currentTime + 0.05;
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = start + i * 0.16;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

// 寶可夢叫聲（PokeAPI cries，.ogg；iPhone 舊版 Safari 不支援就安靜跳過）
const CRIES = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest';
export function cry(id) {
  try {
    const audio = new Audio(`${CRIES}/${id}.ogg`);
    audio.volume = 0.35;
    audio.play().catch(() => {});
  } catch {}
}

export function vibrate(pattern) {
  navigator.vibrate?.(pattern);
}

export function notifyStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotify() {
  if (notifyStatus() !== 'default') return notifyStatus();
  try {
    return await Notification.requestPermission();
  } catch {
    return notifyStatus();
  }
}

export async function notify(title, body) {
  if (notifyStatus() !== 'granted') return;
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'pomomon', renotify: true, vibrate: [200, 100, 200] };
  try {
    // Android Chrome 只接受 Service Worker 發的通知
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch {}
}

let lock = null;
let wantAwake = false;

export async function keepAwake(on) {
  wantAwake = on;
  if (!('wakeLock' in navigator)) return;
  if (on && !lock && document.visibilityState === 'visible') {
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
      });
    } catch {}
  } else if (!on && lock) {
    lock.release();
    lock = null;
  }
}

// 切回來時系統會自動釋放 wake lock，要重新申請
document.addEventListener('visibilitychange', () => {
  if (wantAwake && document.visibilityState === 'visible') keepAwake(true);
});
