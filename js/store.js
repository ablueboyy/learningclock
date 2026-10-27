// 存檔：全部放在 localStorage，另外可以轉成備份序號
import { RARITY, species } from './pokemon.js';

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
    settingsAt: 0, // 設定最後修改時間，同步時新的贏
    mons: [],
    seen: [],
    stats: { sessions: 0, focusMinutes: 0, fails: 0, streak: 0, lastDay: null, today: 0, todayDay: null, cycle: 0 },
    backup: { at: null, count: 0 }, // 上次備份的時間與當時的寶可夢數量
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
    backup: { ...base.backup, ...raw.backup },
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

// ---------- 備份序號 ----------
// 格式：PKMN1- + base64url(deflate(JSON))。寶可夢只存必要欄位，圖鑑用 bitset

const CODE_PREFIX = 'PKMN1-';
const RARITY_KEYS = Object.keys(RARITY);
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const STAT_KEYS = Object.keys(fresh().stats);

async function pipeBytes(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeSave(state) {
  const seen = new Uint8Array(Math.ceil((Math.max(0, ...state.seen) + 1) / 8));
  for (const id of state.seen) seen[id >> 3] |= 1 << (id & 7);
  const payload = [
    SETTING_KEYS.map((k) => state.settings[k]),
    STAT_KEYS.map((k) => state.stats[k]),
    state.mons.map((m) => [m.speciesId, m.exp, RARITY_KEYS.indexOf(m.rarity), (m.shiny ? 1 : 0) | (m.onField ? 2 : 0)]),
    toBase64Url(seen),
  ];
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return CODE_PREFIX + toBase64Url(await pipeBytes(json, new CompressionStream('deflate-raw')));
}

// 回傳新的 state；序號不對就丟錯
export async function decodeSave(code) {
  const clean = code.replace(/\s+/g, '');
  if (!clean.startsWith(CODE_PREFIX)) throw new Error('序號要以 PKMN1- 開頭');
  let payload;
  try {
    const bytes = await pipeBytes(fromBase64Url(clean.slice(CODE_PREFIX.length)), new DecompressionStream('deflate-raw'));
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('序號不完整或有打錯');
  }
  const [settings, stats, mons, seenText] = payload;
  const seenBits = fromBase64Url(seenText);
  const seen = [];
  for (let id = 0; id < seenBits.length * 8; id++) if (seenBits[id >> 3] & (1 << (id & 7))) seen.push(id);
  const now = Date.now();
  return merge({
    settings: Object.fromEntries(SETTING_KEYS.map((k, i) => [k, settings[i]]).filter(([, v]) => v != null)),
    stats: Object.fromEntries(STAT_KEYS.map((k, i) => [k, stats[i]]).filter(([, v]) => v !== undefined)),
    mons: mons.map(([speciesId, exp, rarity, flags], i) => ({
      uid: `r${i}${now.toString(36)}`,
      speciesId,
      exp,
      rarity: RARITY_KEYS[rarity] ?? 'common',
      shiny: Boolean(flags & 1),
      onField: Boolean(flags & 2),
      caughtAt: now - (mons.length - i) * 1000, // 保留原本的順序
    })),
    seen,
    backup: { at: now, count: mons.length },
    timer: null,
  });
}

export function resetData() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// ---------- 雲端同步用的合併 ----------
// 兩份存檔合併時只會「變多」：寶可夢依 uid 取聯集、圖鑑取聯集、統計取較大值。
// 所以不管哪台裝置先上傳，合併結果都一樣，也不會把另一台的寶可夢蓋掉。

export function syncable(state) {
  const { timer, ...rest } = state;
  return rest;
}

const progress = (m) => (species(m.speciesId)?.stage ?? 1) * 100 + m.exp;
const dayNum = (key) => {
  if (!key) return 0;
  const [y, m, d] = key.split('-').map(Number);
  return y * 10000 + m * 100 + d;
};

export function joinSaves(a, b) {
  const mons = new Map();
  for (const m of [...a.mons, ...b.mons]) {
    const cur = mons.get(m.uid);
    // 進化/經驗較多的贏；一樣時看誰比較晚改（例如換上場）
    if (!cur || progress(m) > progress(cur) || (progress(m) === progress(cur) && (m.at ?? 0) > (cur.at ?? 0))) {
      mons.set(m.uid, m);
    }
  }

  const sa = a.stats;
  const sb = b.stats;
  const later = (key) => (dayNum(sb[key]) > dayNum(sa[key]) ? sb : sa);
  const streakSide = later('lastDay');
  const todaySide = later('todayDay');
  const sameToday = sa.todayDay === sb.todayDay;

  return merge({
    settings: (b.settingsAt ?? 0) > (a.settingsAt ?? 0) ? b.settings : a.settings,
    settingsAt: Math.max(a.settingsAt ?? 0, b.settingsAt ?? 0),
    mons: [...mons.values()].sort((x, y) => x.caughtAt - y.caughtAt),
    seen: [...new Set([...a.seen, ...b.seen])].sort((x, y) => x - y),
    stats: {
      sessions: Math.max(sa.sessions, sb.sessions),
      focusMinutes: Math.max(sa.focusMinutes, sb.focusMinutes),
      fails: Math.max(sa.fails, sb.fails),
      cycle: Math.max(sa.cycle, sb.cycle),
      streak: streakSide.streak,
      lastDay: streakSide.lastDay,
      today: sameToday ? Math.max(sa.today, sb.today) : todaySide.today,
      todayDay: todaySide.todayDay,
    },
    backup: (b.backup?.at ?? 0) > (a.backup?.at ?? 0) ? b.backup : a.backup,
    timer: null,
  });
}

// 比較兩份存檔內容是否相同（忽略計時器）
export const sameSave = (a, b) => JSON.stringify(syncable(a)) === JSON.stringify(syncable(b));

// a 裡有沒有 b 沒有的寶可夢
export const hasExtraMons = (a, b) => {
  const ids = new Set(b.mons.map((m) => m.uid));
  return a.mons.some((m) => !ids.has(m.uid));
};

export function parseRemote(json) {
  return merge({ ...JSON.parse(json), timer: null });
}
