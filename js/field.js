// 草地：上場的寶可夢隨機走來走去，可以拖曳、丟出去、甩到頭暈
import { spriteUrl, iconUrl } from './pokemon.js';

const SCALE = 1.5;
const BOTTOM_GAP = 96; // 留給底部選單
const LIFT = 30; // 抓起來時離地的高度
const GRAVITY = 1500;
const DRAG_START = 6; // 移動超過幾 px 才算拖曳，不然算點一下
const THROW_SPEED = 550; // 放開時速度超過這個就是丟出去
const DIZZY_ENERGY = 10; // 甩動累積超過這個會頭暈
const DIZZY_MS = 3200;

const clampAbs = (v, max) => Math.max(-max, Math.min(max, v));

export class Field {
  constructor(el, { onTap, onGrab }) {
    this.el = el;
    this.onTap = onTap;
    this.onGrab = onGrab;
    this.walkers = new Map();
    this.measure();
    new ResizeObserver(() => this.measure()).observe(el);

    let prev = performance.now();
    const loop = (now) => {
      this.step(Math.min(0.05, (now - prev) / 1000), now);
      prev = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  measure() {
    this.w = this.el.clientWidth;
    this.h = this.el.clientHeight;
    for (const w of this.walkers.values()) {
      Object.assign(w, this.clamp(w));
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
      else if (w.speciesId !== m.speciesId || w.shiny !== m.shiny) {
        w.speciesId = m.speciesId;
        w.shiny = m.shiny;
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
    this.el.append(el);

    const p = this.randomPoint();
    const w = {
      el, body, img,
      uid: mon.uid,
      speciesId: mon.speciesId,
      shiny: mon.shiny,
      x: p.x, y: p.y, z: 0,
      vx: 0, vy: 0, vz: 0,
      tilt: 0,
      mode: 'walk', // walk | held | air | dizzy
      target: this.randomPoint(),
      speed: 16 + Math.random() * 22,
      wait: performance.now() + Math.random() * 3000,
      facing: 1,
    };
    this.walkers.set(mon.uid, w);
    this.bindDrag(w);
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

  // ---------- 拖曳 ----------

  bindDrag(w) {
    let drag = null;
    const point = (e) => {
      const r = this.el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
    };

    w.el.addEventListener('pointerdown', (e) => {
      if (w.mode === 'air') return;
      e.preventDefault();
      w.el.setPointerCapture(e.pointerId);
      const p = point(e);
      // 手指和腳底的距離，拖的時候保持一樣，寶可夢不會跳到手指下面
      drag = { start: p, last: p, dx: w.x - p.x, dy: w.y - p.y, moved: false, samples: [p], energy: 0 };
    });

    w.el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = point(e);
      if (!drag.moved) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < DRAG_START) return;
        drag.moved = true;
        this.pickUp(w);
      }
      // 甩得很快就累積頭暈值，慢下來會慢慢消退
      const dt = Math.max(1, p.t - drag.last.t) / 1000;
      const speed = Math.hypot(p.x - drag.last.x, p.y - drag.last.y) / dt;
      drag.energy = drag.energy * 0.94 + (speed > 1100 ? 1 : 0);
      if (drag.energy > DIZZY_ENERGY) w.dizzy = true;
      drag.last = p;
      drag.samples.push(p);
      while (drag.samples.length > 2 && p.t - drag.samples[0].t > 90) drag.samples.shift();
      w.target = this.clamp({ x: p.x + drag.dx, y: p.y + drag.dy });
    });

    const end = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) {
        this.onTap(w.uid);
        return;
      }
      // 用最後 90ms 的移動算放開時的速度
      const first = d.samples[0];
      const last = d.samples[d.samples.length - 1];
      const dt = Math.max(16, last.t - first.t) / 1000;
      const vx = (last.x - first.x) / dt;
      const vy = (last.y - first.y) / dt;
      this.release(w, e.type === 'pointercancel' ? 0 : vx, e.type === 'pointercancel' ? 0 : vy);
    };
    w.el.addEventListener('pointerup', end);
    w.el.addEventListener('pointercancel', end);
  }

  pickUp(w) {
    w.mode = 'held';
    w.dizzy = false;
    w.target = { x: w.x, y: w.y };
    w.el.classList.add('held');
    w.el.classList.remove('walking', 'dizzy');
    this.emote(w, '！');
    this.onGrab?.(w.uid);
  }

  release(w, vx, vy) {
    w.el.classList.remove('held');
    w.mode = 'air';
    w.bounced = false;
    w.thrown = Math.hypot(vx, vy) > THROW_SPEED;
    if (w.thrown) {
      w.vx = clampAbs(vx * 0.7, 1400);
      w.vy = clampAbs(vy * 0.7, 1400);
      w.vz = 380;
    } else {
      w.vx = 0;
      w.vy = 0;
      w.vz = 60;
    }
  }

  land(w, now) {
    w.z = 0;
    w.vz = 0;
    w.tilt = 0;
    w.target = this.randomPoint();
    if (w.dizzy) {
      w.mode = 'dizzy';
      w.dizzyUntil = now + DIZZY_MS;
      w.el.classList.add('dizzy');
      this.emote(w, '@', DIZZY_MS);
    } else {
      w.mode = 'walk';
      w.wait = now + 900 + Math.random() * 1200;
      this.emote(w, w.thrown ? '！？' : '♪');
      if (!w.thrown) this.hop(w.uid);
    }
    this.startle(w, now);
  }

  // 落地時，附近的夥伴會轉過來看、跳一下
  startle(src, now) {
    for (const w of this.walkers.values()) {
      if (w === src || w.mode !== 'walk') continue;
      if (Math.hypot(w.x - src.x, w.y - src.y) > (src.thrown ? 130 : 90)) continue;
      this.face(w, src.x > w.x ? -1 : 1);
      w.wait = now + 1200;
      setTimeout(() => {
        this.hop(w.uid);
        if (Math.random() < 0.5) this.emote(w, '？');
      }, 80 + Math.random() * 200);
    }
  }

  // ---------- 每一幀 ----------

  step(dt, now) {
    for (const w of this.walkers.values()) {
      if (w.mode === 'held') this.stepHeld(w, dt);
      else if (w.mode === 'air') this.stepAir(w, dt, now);
      else if (w.mode === 'dizzy') {
        if (now > w.dizzyUntil) {
          w.mode = 'walk';
          w.dizzy = false;
          w.wait = now + 600;
          w.el.classList.remove('dizzy');
        }
        continue;
      } else this.stepWalk(w, dt, now);
      this.place(w);
    }
  }

  stepHeld(w, dt) {
    const k = Math.min(1, dt * 18);
    const dx = (w.target.x - w.x) * k;
    w.x += dx;
    w.y += (w.target.y - w.y) * k;
    w.z += (LIFT - w.z) * Math.min(1, dt * 12);
    // 往哪邊拖就往那邊歪
    w.tilt += (clampAbs(dx * 4, 25) - w.tilt) * Math.min(1, dt * 10);
    if (Math.abs(dx) > 0.3) this.face(w, dx > 0 ? -1 : 1);
  }

  stepAir(w, dt, now) {
    const a = this.area();
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    const friction = Math.max(0, 1 - 1.6 * dt);
    w.vx *= friction;
    w.vy *= friction;
    // 撞到邊界就彈回來
    if (w.x < a.left || w.x > a.right) {
      w.x = Math.min(a.right, Math.max(a.left, w.x));
      w.vx = -w.vx * 0.6;
    }
    if (w.y < a.top || w.y > a.bottom) {
      w.y = Math.min(a.bottom, Math.max(a.top, w.y));
      w.vy = -w.vy * 0.6;
    }
    w.vz -= GRAVITY * dt;
    w.z += w.vz * dt;
    w.tilt = w.thrown ? w.tilt + clampAbs(w.vx, 600) * dt * 0.9 : w.tilt * Math.max(0, 1 - dt * 10);
    if (Math.abs(w.vx) > 20) this.face(w, w.vx > 0 ? -1 : 1);
    if (w.z <= 0) {
      if (!w.bounced && w.vz < -220) {
        w.z = 0;
        w.vz = -w.vz * 0.35;
        w.bounced = true;
        w.tilt = 0;
      } else this.land(w, now);
    }
  }

  stepWalk(w, dt, now) {
    if (now < w.wait) {
      w.el.classList.remove('walking');
      return;
    }
    const dx = w.target.x - w.x;
    const dy = w.target.y - w.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      // 到了就發呆一下，偶爾坐比較久
      w.wait = now + 800 + Math.random() * (Math.random() < 0.2 ? 9000 : 3500);
      w.target = this.randomPoint();
      return;
    }
    const move = Math.min(dist, w.speed * dt);
    w.x += (dx / dist) * move;
    w.y += (dy / dist) * move;
    if (Math.abs(dx) > 0.5) this.face(w, dx > 0 ? -1 : 1);
    w.el.classList.add('walking');
  }

  // 第五代圖片預設面向左
  face(w, facing) {
    if (facing === w.facing) return;
    w.facing = facing;
    w.img.style.transform = `scaleX(${facing})`;
  }

  place(w) {
    w.el.style.transform = `translate(${w.x}px, ${w.y}px)`;
    w.el.style.zIndex = w.mode === 'held' ? '9999' : String(Math.round(w.y));
    w.body.style.transform = `translateX(-50%) translateY(${-w.z}px) rotate(${w.tilt}deg)`;
    // 離地越高影子越小越淡
    w.el.style.setProperty('--shadow', String(Math.max(0.45, 1 - w.z / 120)));
  }

  // ---------- 反應 ----------

  hop(uid) {
    this.walkers.get(uid)?.body.animate(
      [{ translate: '0 0' }, { translate: '0 -18px' }, { translate: '0 0' }],
      { duration: 380, easing: 'ease-out' },
    );
  }

  emote(w, text, ms = 1100) {
    w.body.querySelector('.emote')?.remove();
    const el = document.createElement('div');
    el.className = 'emote';
    el.textContent = text;
    w.body.append(el);
    setTimeout(() => el.remove(), ms);
  }

  say(uid, html, ms = 2600) {
    const w = this.walkers.get(uid);
    if (!w) return;
    w.body.querySelector('.bubble')?.remove();
    w.body.querySelector('.emote')?.remove();
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = html;
    w.body.append(bubble);
    if (w.mode === 'walk') w.wait = performance.now() + ms;
    setTimeout(() => bubble.remove(), ms);
  }

  celebrate() {
    for (const w of this.walkers.values()) setTimeout(() => this.hop(w.uid), Math.random() * 500);
  }
}
