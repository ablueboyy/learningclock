// 草地：上場的寶可夢隨機走來走去
import { spriteUrl, iconUrl } from './pokemon.js';

const SCALE = 1.5;
const BOTTOM_GAP = 96; // 留給底部選單

export class Field {
  constructor(el, onTap) {
    this.el = el;
    this.onTap = onTap;
    this.walkers = new Map();
    this.measure();
    new ResizeObserver(() => this.measure()).observe(el);

    let prev = performance.now();
    const loop = (now) => {
      this.step(Math.min(0.1, (now - prev) / 1000), now);
      prev = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  measure() {
    this.w = this.el.clientWidth;
    this.h = this.el.clientHeight;
    for (const w of this.walkers.values()) {
      const p = this.clamp(w);
      w.x = p.x;
      w.y = p.y;
      this.place(w);
    }
  }

  area() {
    const top = 70;
    return { left: 32, right: Math.max(33, this.w - 32), top, bottom: Math.max(top + 10, this.h - BOTTOM_GAP) };
  }

  clamp({ x, y }) {
    const a = this.area();
    return { x: Math.min(a.right, Math.max(a.left, x)), y: Math.min(a.bottom, Math.max(a.top, y)) };
  }

  randomPoint() {
    const a = this.area();
    return { x: a.left + Math.random() * (a.right - a.left), y: a.top + Math.random() * (a.bottom - a.top) };
  }

  sync(mons) {
    const want = new Map(mons.filter((m) => m.onField).map((m) => [m.uid, m]));
    for (const [uid, w] of this.walkers) {
      if (!want.has(uid)) {
        w.el.remove();
        this.walkers.delete(uid);
      }
    }
    for (const m of want.values()) {
      const w = this.walkers.get(m.uid);
      if (!w) this.add(m);
      else if (w.speciesId !== m.speciesId) {
        w.speciesId = m.speciesId;
        this.setSprite(w.img, m);
      }
    }
    return want.size;
  }

  add(mon) {
    const el = document.createElement('div');
    el.className = 'walker';
    const body = document.createElement('div');
    body.className = 'walker-body';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.alt = '';
    img.draggable = false;
    this.setSprite(img, mon);
    body.append(img);
    el.append(body);
    el.addEventListener('click', () => this.onTap(mon.uid));
    this.el.append(el);

    const p = this.randomPoint();
    const w = {
      el, body, img,
      uid: mon.uid,
      speciesId: mon.speciesId,
      x: p.x, y: p.y,
      target: this.randomPoint(),
      speed: 16 + Math.random() * 22,
      wait: performance.now() + Math.random() * 3000,
      facing: 1,
    };
    this.walkers.set(mon.uid, w);
    this.place(w);
  }

  setSprite(img, mon) {
    img.onload = () => {
      img.style.width = `${img.naturalWidth * SCALE}px`;
    };
    img.onerror = () => {
      img.onerror = null;
      img.src = iconUrl(mon.speciesId, mon.shiny);
    };
    img.src = spriteUrl(mon.speciesId, mon.shiny);
  }

  step(dt, now) {
    for (const w of this.walkers.values()) {
      if (now < w.wait) {
        w.el.classList.remove('walking');
        continue;
      }
      const dx = w.target.x - w.x;
      const dy = w.target.y - w.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        // 到了就發呆一下，偶爾坐比較久
        w.wait = now + 800 + Math.random() * (Math.random() < 0.2 ? 9000 : 3500);
        w.target = this.randomPoint();
        continue;
      }
      const move = Math.min(dist, w.speed * dt);
      w.x += (dx / dist) * move;
      w.y += (dy / dist) * move;
      // 第五代圖片預設面向左
      const facing = dx > 0.5 ? -1 : dx < -0.5 ? 1 : w.facing;
      if (facing !== w.facing) {
        w.facing = facing;
        w.img.style.transform = `scaleX(${facing})`;
      }
      w.el.classList.add('walking');
      this.place(w);
    }
  }

  place(w) {
    w.el.style.transform = `translate(${w.x}px, ${w.y}px)`;
    w.el.style.zIndex = String(Math.round(w.y));
  }

  hop(uid) {
    this.walkers.get(uid)?.body.animate(
      [{ translate: '0 0' }, { translate: '0 -18px' }, { translate: '0 0' }],
      { duration: 380, easing: 'ease-out' },
    );
  }

  say(uid, html, ms = 2600) {
    const w = this.walkers.get(uid);
    if (!w) return;
    w.body.querySelector('.bubble')?.remove();
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = html;
    w.body.append(bubble);
    w.wait = performance.now() + ms;
    setTimeout(() => bubble.remove(), ms);
  }

  celebrate() {
    for (const w of this.walkers.values()) setTimeout(() => this.hop(w.uid), Math.random() * 500);
  }
}
