// 存檔：全部放在 localStorage，另外可以轉成備份序號
import { RARITY } from './pokemon.js';

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
