// 寶可夢資料、抽獎、經驗與進化
export const RARITY = {
  common: { label: '普通', weight: 60 },
  rare: { label: '稀有', weight: 25 },
  epic: { label: '超稀有', weight: 10 },
  legendary: { label: '傳說', weight: 4 },
  mythic: { label: '神話', weight: 1 },
};

export const SHINY_CHANCE = 1 / 100;

// 一階 → 二階需要的經驗、二階 → 三階需要的經驗（進化後歸零重算）
const EVOLVE_EXP = { 1: 3, 2: 7 };

const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

let dex = [];
let byId = new Map();

export async function loadDex() {
  const res = await fetch('data/pokedex.json');
  dex = await res.json();
  byId = new Map(dex.map((p) => [p.id, p]));
  return dex;
}

export const species = (id) => byId.get(id);
export const allSpecies = () => dex;

// 會動的第五代 GIF；載入失敗時用 iconUrl 的靜態圖
export const spriteUrl = (id, shiny) =>
  id <= 649
    ? `${SPRITES}/versions/generation-v/black-white/animated/${shiny ? 'shiny/' : ''}${id}.gif`
    : `${SPRITES}/other/showdown/${shiny ? 'shiny/' : ''}${id}.gif`;
export const iconUrl = (id, shiny) => `${SPRITES}/${shiny ? 'shiny/' : ''}${id}.png`;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function pickRarity(rng) {
  const entries = Object.entries(RARITY);
  const total = entries.reduce((sum, [, r]) => sum + r.weight, 0);
  let roll = rng() * total;
  for (const [key, r] of entries) {
    roll -= r.weight;
    if (roll < 0) return key;
  }
  return entries[0][0];
}

export function draw(rng = Math.random) {
  const rarity = pickRarity(rng);
  const pool = dex.filter((p) => p.base && p.rarity === rarity);
  const sp = pool[Math.floor(rng() * pool.length)];
  return {
    uid: uid(),
    speciesId: sp.id,
    rarity,
    exp: 0,
    shiny: rng() < SHINY_CHANCE,
    caughtAt: Date.now(),
    onField: true,
  };
}

// 不會再進化時回傳 null
export function expNeeded(mon) {
  const sp = species(mon.speciesId);
  if (!sp.evolvesTo.length) return null;
  return EVOLVE_EXP[sp.stage] ?? EVOLVE_EXP[2];
}

// 加經驗；有進化就回傳 { mon, from, to }
export function gainExp(mon, amount = 1, rng = Math.random) {
  mon.exp += amount;
  const need = expNeeded(mon);
  if (need == null || mon.exp < need) return null;
  const sp = species(mon.speciesId);
  const to = sp.evolvesTo[Math.floor(rng() * sp.evolvesTo.length)];
  const from = mon.speciesId;
  mon.speciesId = to;
  mon.exp = 0;
  return { mon, from, to };
}
