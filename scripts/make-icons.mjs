// 產生 PWA 圖示（球 + 天空背景），不需要額外套件
// 用法：node scripts/make-icons.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const SKY = [143, 211, 255];
const RED = [239, 83, 80];
const WHITE = [250, 250, 250];
const DARK = [34, 34, 34];

// 以 0..1 座標回傳顏色
function color(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const d = Math.hypot(dx, dy);
  const R = 0.34; // 留邊給 maskable 安全區
  if (d > R) return SKY;
  if (d > R - 0.03) return DARK;
  if (d < 0.07) return d < 0.045 ? WHITE : DARK;
  if (Math.abs(dy) < 0.025) return DARK;
  return dy < 0 ? RED : WHITE;
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const SS = 4; // 超取樣抗鋸齒
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = color((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="22" fill="#8fd3ff"/>
<circle cx="50" cy="50" r="34" fill="#fafafa" stroke="#222" stroke-width="5"/>
<path d="M16 50a34 34 0 0 1 68 0z" fill="#ef5350" stroke="#222" stroke-width="5"/>
<circle cx="50" cy="50" r="9" fill="#fafafa" stroke="#222" stroke-width="5"/>
</svg>`;

const dir = new URL('../icons/', import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL('icon-192.png', dir), png(192));
await writeFile(new URL('icon-512.png', dir), png(512));
await writeFile(new URL('icon.svg', dir), svg);
console.log('icons written');
