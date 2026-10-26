// 從 PokéAPI 產生 data/pokedex.json（全部寶可夢）
// 用法：node scripts/build-pokedex.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const API = 'https://pokeapi.co/api/v2';

// 御三家
const STARTERS = [
  1, 4, 7, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501,
  650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912,
];
const FOSSILS = [138, 140, 142, 345, 347, 408, 410, 564, 566, 696, 698, 880, 881, 882, 883];
// 手動加到「傳說」的人氣寶可夢
const LEGENDARY_EXTRA = [131, 143];
// 手動加到「超稀有」
const EPIC_EXTRA = [129, 133, 123, 127];

const idFromUrl = (url) => Number(url.split('/').filter(Boolean).pop());

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  throw new Error(`fetch failed: ${url}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
      if (++done % 100 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
  return out;
}

const { count } = await getJson(`${API}/pokemon-species?limit=1`);
const ids = Array.from({ length: count }, (_, i) => i + 1);
console.log(`fetching ${count} species…`);

const species = await mapLimit(ids, 12, async (id) => {
  const [s, p] = await Promise.all([
    getJson(`${API}/pokemon-species/${id}`),
    getJson(`${API}/pokemon/${id}`),
  ]);
  const name = (lang) => s.names.find((n) => n.language.name === lang)?.name;
  return {
    id,
    name: name('zh-hant') ?? name('zh-hans') ?? name('en'),
    en: name('en'),
    gen: idFromUrl(s.generation.url),
    bst: p.stats.reduce((sum, st) => sum + st.base_stat, 0),
    legend: s.is_legendary || s.is_mythical,
    evolvesFrom: s.evolves_from_species ? idFromUrl(s.evolves_from_species.url) : null,
    chainUrl: s.evolution_chain.url,
  };
});

const byId = new Map(species.map((s) => [s.id, s]));

console.log('fetching evolution chains…');
const chainUrls = [...new Set(species.map((s) => s.chainUrl))];
const chains = await mapLimit(chainUrls, 12, getJson);
const evolvesTo = new Map();
function walk(node) {
  evolvesTo.set(idFromUrl(node.species.url), node.evolves_to.map((n) => idFromUrl(n.species.url)));
  node.evolves_to.forEach(walk);
}
chains.forEach((c) => walk(c.chain));

const stage = (s) => (s.evolvesFrom ? stage(byId.get(s.evolvesFrom)) + 1 : 1);
const finalBst = (id) => {
  const kids = evolvesTo.get(id) ?? [];
  return kids.length ? Math.max(...kids.map(finalBst)) : byId.get(id).bst;
};
// 整條進化線裡有沒有傳說/幻之（例如 科斯莫古、熊徒弟）
const lineLegend = (id) => byId.get(id).legend || (evolvesTo.get(id) ?? []).some(lineLegend);

const rarityOf = (s) => {
  const top = finalBst(s.id);
  if (lineLegend(s.id)) return 'mythic';
  if (FOSSILS.includes(s.id) || LEGENDARY_EXTRA.includes(s.id) || top >= 570) return 'legendary';
  if (STARTERS.includes(s.id) || EPIC_EXTRA.includes(s.id) || top >= 520) return 'epic';
  return top >= 480 ? 'rare' : 'common';
};

const out = species.map((s) => ({
  id: s.id,
  name: s.name,
  gen: s.gen,
  stage: stage(s),
  base: !s.evolvesFrom,
  evolvesTo: evolvesTo.get(s.id) ?? [],
  rarity: s.evolvesFrom ? null : rarityOf(s),
}));

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/pokedex.json', import.meta.url), JSON.stringify(out));

const counts = {};
out.filter((p) => p.base).forEach((p) => (counts[p.rarity] = (counts[p.rarity] ?? 0) + 1));
console.log('base forms by rarity:', counts);
