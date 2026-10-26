// 存檔：全部放在 localStorage
const KEY = 'pomomon-v1';

export const FIELD_LIMIT = 6;

export const DEFAULT_SETTINGS = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  fieldMax: 6,
  autoBreak: true,
  wakeLock: true,
  sound: true,
};

function fresh() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    mons: [],
    seen: [],
    stats: { sessions: 0, focusMinutes: 0, fails: 0, streak: 0, lastDay: null, today: 0, todayDay: null, cycle: 0 },
    timer: null,
  };
}

function merge(raw) {
  const base = fresh();
  const state = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...raw.settings },
    stats: { ...base.stats, ...raw.stats },
  };
  // 舊版上限是 12 隻：超過的從最舊的開始下場
  state.settings.fieldMax = Math.min(FIELD_LIMIT, state.settings.fieldMax);
  let onField = 0;
  for (let i = state.mons.length - 1; i >= 0; i--) {
    if (state.mons[i].onField && ++onField > state.settings.fieldMax) state.mons[i].onField = false;
  }
  return state;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(JSON.parse(raw));
  } catch {}
  return fresh();
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export function exportData(state) {
  const { timer, ...rest } = state;
  return JSON.stringify({ app: 'pomomon', version: 1, ...rest }, null, 2);
}

// 回傳新的 state；格式不對就丟錯
export function importData(text) {
  const raw = JSON.parse(text);
  if (raw.app !== 'pomomon' || !Array.isArray(raw.mons)) throw new Error('不是正確的備份檔');
  const { app, version, ...rest } = raw;
  return merge({ ...rest, timer: null });
}

export function resetData() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
