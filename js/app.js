import {
  load, save, exportData, importData, resetData, encodeSave, decodeSave,
  syncable, joinSaves, sameSave, hasExtraMons, parseRemote,
} from './store.js';
import {
  syncAvailable, startSync, schedulePush, pushNow, markRemote,
  signUp, signIn, signOut, resetPassword, authMessage,
} from './sync.js';
import { loadDex, species, allSpecies, draw, gainExp, expNeeded, spriteUrl, iconUrl, RARITY } from './pokemon.js';
import { Field } from './field.js';
import { unlockAudio, chime, vibrate, notifyStatus, requestNotify, notify, keepAwake } from './notify.js';

const AWAY_LIMIT = 3 * 60_000; // 單次切出最多 3 分鐘
const AWAY_GRACE = 3_000; // 3 秒內的切換不算
const RING = 2 * Math.PI * 54;
// 網址加 ?dev 時一分鐘只算一秒，方便測試
const MINUTE = new URLSearchParams(location.search).has('dev') ? 1000 : 60_000;

const LINK_KEY = 'pomomon-sync'; // 這台裝置的資料已經跟哪個帳號合併過
const BEFORE_LINK_KEY = 'pomomon-before-sync'; // 選「只用帳號的資料」前，保留一份這台原本的存檔

const $ = (id) => document.getElementById(id);

let state = load();
await loadDex();

const field = new Field($('field'), onTapMon);
let busy = false; // 正在跑完成/失敗流程

let user = null; // 已登入的帳號
let linked = false; // 這台的資料已經和帳號合併，可以自動同步
let linking = false;
let pendingRemote = null; // 獎勵動畫期間收到的雲端資料，結束後再套用

const toJson = (s) => JSON.stringify(syncable(s));
const mergeJson = (remoteJson, localJson) => toJson(joinSaves(parseRemote(localJson), parseRemote(remoteJson)));

function persist() {
  save(state);
  if (user && linked) schedulePush(user.uid, toJson(state), mergeJson);
}

// ---------- 小工具 ----------

const fmt = (ms) => {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const dayKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const todayCount = () => (state.stats.todayDay === dayKey() ? state.stats.today : 0);
const allowance = () => Math.max(1, Math.floor(state.settings.focusMin / 10));
const fieldCount = () => state.mons.filter((m) => m.onField).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const monName = (m) => `${species(m.speciesId).name}${m.shiny ? ' ✦' : ''}`;

function expText(m) {
  const need = expNeeded(m);
  return need == null ? '最終型態' : `再 ${need - m.exp} 次進化`;
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function sound(kind) {
  if (state.settings.sound) chime(kind);
}

// 開對話框並等它關掉
function openDialog(dlg) {
  return new Promise((resolve) => {
    dlg.addEventListener('close', resolve, { once: true });
    dlg.showModal();
  });
}

// ---------- 計時 ----------

function startTimer(mode) {
  const s = state.settings;
  const min = mode === 'focus' ? s.focusMin : mode === 'short' ? s.shortMin : s.longMin;
  state.timer = {
    mode,
    duration: min * MINUTE,
    endAt: Date.now() + min * MINUTE,
    leavesLeft: mode === 'focus' ? allowance() : 0,
    leftAt: null,
  };
  persist();
  render();
}

function tick() {
  if (!busy && pendingRemote) {
    const [json, u] = pendingRemote;
    pendingRemote = null;
    onRemote(json, u);
  }
  const t = state.timer;
  if (t && !busy && Date.now() >= t.endAt) {
    if (t.mode === 'focus') finishFocus();
    else finishBreak();
  }
  render();
}

async function finishFocus() {
  busy = true;
  const t = state.timer;
  const st = state.stats;
  const day = dayKey();

  st.sessions++;
  st.focusMinutes += Math.round(t.duration / MINUTE);
  st.cycle++;
  if (st.todayDay !== day) {
    st.todayDay = day;
    st.today = 0;
  }
  st.today++;
  if (st.lastDay !== day) {
    st.streak = st.lastDay === dayKey(-1) ? st.streak + 1 : 1;
    st.lastDay = day;
  }

  // 先幫現有夥伴加經驗，再抽新的（新抽到的這次不加）
  const evolutions = state.mons.map((m) => gainExp(m)).filter(Boolean);
  const mon = draw();
  mon.onField = fieldCount() < state.settings.fieldMax;
  const isNew = !state.seen.includes(mon.speciesId);
  state.mons.push(mon);
  for (const id of [mon.speciesId, ...evolutions.map((e) => e.to)]) {
    if (!state.seen.includes(id)) state.seen.push(id);
  }
  state.timer = null;
  persist();

  sound('done');
  vibrate([200, 100, 200, 100, 400]);
  if (document.hidden) notify('專注完成！', `你獲得了 ${species(mon.speciesId).name}，休息一下吧`);
  render();

  await showReward(mon, isNew);
  for (const e of evolutions) await showEvolution(e);
  field.sync(state.mons);
  field.celebrate();
  const unsaved = state.mons.length - state.backup.count;
  if (unsaved > 0 && unsaved % 5 === 0) toast(`已經有 ${unsaved} 隻夥伴還沒備份，到「設定」取得序號吧`);
  render();
  busy = false;

  if (state.settings.autoBreak) startTimer(st.cycle % state.settings.longEvery === 0 ? 'long' : 'short');
}

function finishBreak() {
  state.timer = null;
  persist();
  sound('break');
  vibrate([300, 150, 300]);
  if (document.hidden) notify('休息結束', '回來開始下一輪專注吧！');
  toast('休息結束，準備下一輪專注！');
}

async function failFocus(reason) {
  busy = true;
  state.stats.fails++;
  state.timer = null;
  persist();
  sound('fail');
  vibrate(400);
  render();
  $('failReason').textContent = reason;
  await openDialog($('fail'));
  busy = false;
}

// 從背景回來時檢查切出的次數與時間
function checkReturn() {
  const t = state.timer;
  if (!t || t.mode !== 'focus' || !t.leftAt) return;
  const away = Math.min(Date.now(), t.endAt) - t.leftAt;
  t.leftAt = null;
  persist();
  if (away < AWAY_GRACE) return;
  if (t.leavesLeft <= 0) failFocus('切出 App 的次數用完了，可達鴨很難過…');
  else if (away > AWAY_LIMIT) failFocus(`離開了 ${fmt(away)}，超過 3 分鐘了…`);
  else {
    t.leavesLeft--;
    persist();
    toast(`離開了 ${fmt(away)}，還剩 ${t.leavesLeft} 次切出機會`);
  }
}

document.addEventListener('visibilitychange', () => {
  const t = state.timer;
  if (document.hidden) {
    if (t?.mode === 'focus' && !busy && Date.now() < t.endAt) {
      t.leftAt = Date.now();
      persist();
    }
  } else {
    checkReturn();
    tick();
  }
});

// ---------- 畫面 ----------

function render() {
  const t = state.timer;
  const s = state.settings;
  const mode = t ? (t.mode === 'focus' ? 'focus' : 'break') : 'idle';
  document.body.dataset.mode = mode;
  document.querySelector('meta[name="theme-color"]').content = mode === 'focus' ? '#0f1a33' : '#8fd3ff';

  const left = t ? Math.max(0, t.endAt - Date.now()) : s.focusMin * MINUTE;
  const time = fmt(left);
  $('time').textContent = time;
  $('ring').style.strokeDasharray = RING;
  $('ring').style.strokeDashoffset = t ? RING * (1 - left / t.duration) : 0;
  document.title = t ? `${time} · ${t.mode === 'focus' ? '專注中' : '休息中'}` : '寶可夢專注鐘';

  const mainBtn = $('mainBtn');
  const altBtn = $('altBtn');
  const quota = $('quota');
  if (mode === 'idle') {
    $('modeLabel').textContent = '準備好了嗎？';
    $('sub').textContent = `今天完成 ${todayCount()} 次`;
    mainBtn.hidden = false;
    mainBtn.textContent = '開始專注';
    altBtn.hidden = true;
    quota.hidden = true;
  } else if (mode === 'focus') {
    $('modeLabel').textContent = '專注中';
    $('sub').textContent = `第 ${state.stats.cycle + 1} 輪`;
    mainBtn.hidden = true;
    altBtn.hidden = false;
    quota.hidden = false;
    const total = allowance();
    const dots = Array.from({ length: Math.max(total, t.leavesLeft) }, (_, i) =>
      `<i class="${i < t.leavesLeft ? 'on' : ''}"></i>`).join('');
    quota.innerHTML = `<span class="dots">${dots}</span>可切出 ${t.leavesLeft} 次`;
  } else {
    $('modeLabel').textContent = t.mode === 'long' ? '長休息' : '休息一下';
    $('sub').textContent = '起來走走、喝口水';
    mainBtn.hidden = false;
    mainBtn.textContent = '跳過休息';
    altBtn.hidden = true;
    quota.hidden = true;
  }

  $('monCount').textContent = state.mons.length;
  $('fieldEmpty').hidden = state.mons.length > 0;
}

function onTapMon(uid) {
  const m = state.mons.find((x) => x.uid === uid);
  if (!m) return;
  field.hop(uid);
  field.say(uid, `<b>${escapeHtml(monName(m))}</b><small>${expText(m)}</small>`);
}

// ---------- 獎勵與進化 ----------

function rarityTag(rarity) {
  return `<span class="rarity r-${rarity}">${RARITY[rarity].label}</span>`;
}

async function showReward(mon, isNew) {
  const dlg = $('reward');
  const stage = $('rewardStage');
  const sp = species(mon.speciesId);
  stage.className = `stage r-${mon.rarity}`;
  $('rewardImg').src = spriteUrl(mon.speciesId, mon.shiny);
  $('rewardImg').onerror = () => ($('rewardImg').src = iconUrl(mon.speciesId, mon.shiny));
  $('rewardInfo').innerHTML = '';
  $('rewardOk').disabled = true;

  const closed = openDialog(dlg);
  await sleep(1800);
  stage.classList.add('revealed');
  if (mon.rarity === 'legendary' || mon.rarity === 'mythic' || mon.shiny) vibrate([100, 60, 100, 60, 100]);
  $('rewardInfo').innerHTML = `
    <div class="tags">${rarityTag(mon.rarity)}${isNew ? '<span class="new">NEW</span>' : ''}${mon.shiny ? '<span class="shiny">✦ 異色</span>' : ''}</div>
    <h2>${escapeHtml(sp.name)}</h2>
    <p>${mon.onField ? '已經跑到草地上了！' : '草地滿了，到「夥伴」裡可以換上場'}</p>`;
  $('rewardOk').disabled = false;
  await closed;
}

async function showEvolution({ mon, from, to }) {
  const dlg = $('evolve');
  const img = $('evoImg');
  img.className = 'evo-img';
  img.src = spriteUrl(from, mon.shiny);
  $('evoInfo').innerHTML = `<h2>${escapeHtml(species(from).name)} 的樣子……</h2>`;
  $('evoOk').disabled = true;

  const closed = openDialog(dlg);
  await sleep(400);
  img.classList.add('evolving');
  await sleep(2600);
  img.src = spriteUrl(to, mon.shiny);
  img.classList.remove('evolving');
  img.classList.add('evolved');
  sound('done');
  vibrate([150, 80, 300]);
  $('evoInfo').innerHTML = `<h2>${escapeHtml(species(from).name)} 進化成了<br>${escapeHtml(species(to).name)}！</h2>`;
  $('evoOk').disabled = false;
  await closed;
}

// ---------- 夥伴 / 圖鑑 ----------

function renderParty() {
  const list = $('party');
  const mons = [...state.mons].sort((a, b) => b.caughtAt - a.caughtAt);
  $('partyHint').textContent = mons.length
    ? `草地上 ${fieldCount()} / ${state.settings.fieldMax} 隻，點開關換上場的夥伴`
    : '還沒有夥伴，完成一次專注就能抽一隻！';
  list.innerHTML = mons.map((m) => {
    const need = expNeeded(m);
    const pct = need == null ? 100 : (m.exp / need) * 100;
    return `<li class="mon-card">
      <img src="${iconUrl(m.speciesId, m.shiny)}" alt="" loading="lazy" crossorigin="anonymous">
      <div class="mon-meta">
        <div class="mon-name">${escapeHtml(monName(m))} ${rarityTag(m.rarity)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <small>${need == null ? '最終型態' : `經驗 ${m.exp} / ${need} · ${expText(m)}`}</small>
      </div>
      <label class="switch" aria-label="上場"><input type="checkbox" data-uid="${m.uid}" ${m.onField ? 'checked' : ''}><span></span></label>
    </li>`;
  }).join('');
}

let dexGen = 1;

function renderDex() {
  const seen = new Set(state.seen);
  const all = allSpecies();
  $('dexCount').textContent = `${seen.size}/${all.length}`;
  const gens = [...new Set(all.map((p) => p.gen))];
  $('genChips').innerHTML = gens.map((g) => {
    const list = all.filter((p) => p.gen === g);
    const got = list.filter((p) => seen.has(p.id)).length;
    return `<button class="chip" data-gen="${g}" aria-pressed="${g === dexGen}">第 ${g} 世代 <small>${got}/${list.length}</small></button>`;
  }).join('');
  $('dex').innerHTML = all.filter((p) => p.gen === dexGen).map((p) => `
    <li class="${seen.has(p.id) ? 'seen' : ''}">
      <img src="${iconUrl(p.id)}" alt="" loading="lazy" crossorigin="anonymous">
      <span>${seen.has(p.id) ? escapeHtml(p.name) : `#${String(p.id).padStart(3, '0')}`}</span>
    </li>`).join('');
}

$('party').addEventListener('change', (e) => {
  const input = e.target.closest('input[data-uid]');
  if (!input) return;
  const m = state.mons.find((x) => x.uid === input.dataset.uid);
  if (input.checked && fieldCount() >= state.settings.fieldMax) {
    input.checked = false;
    toast(`草地最多 ${state.settings.fieldMax} 隻，先讓其他夥伴休息吧`);
    return;
  }
  m.onField = input.checked;
  m.at = Date.now();
  persist();
  field.sync(state.mons);
  $('partyHint').textContent = `草地上 ${fieldCount()} / ${state.settings.fieldMax} 隻，點開關換上場的夥伴`;
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    const dex = tab.dataset.tab === 'dex';
    $('dex').hidden = !dex;
    $('genChips').hidden = !dex;
    $('party').hidden = dex;
    $('partyHint').hidden = dex;
  });
});

$('genChips').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-gen]');
  if (!chip) return;
  dexGen = Number(chip.dataset.gen);
  renderDex();
  $('genChips').querySelector('[aria-pressed="true"]').scrollIntoView({ inline: 'nearest', block: 'nearest' });
  $('dex').closest('.sheet-body').scrollTop = 0;
});

// ---------- 設定 ----------

function renderSettings() {
  const st = state.stats;
  const hours = (st.focusMinutes / 60).toFixed(1);
  $('stats').innerHTML = `
    <div><b>${st.sessions}</b><span>完成次數</span></div>
    <div><b>${hours}</b><span>專注小時</span></div>
    <div><b>${st.lastDay === dayKey() || st.lastDay === dayKey(-1) ? st.streak : 0}</b><span>連續天數</span></div>
    <div><b>${st.fails}</b><span>中斷次數</span></div>`;
  document.querySelectorAll('[data-setting]').forEach((input) => {
    const v = state.settings[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = v;
    else input.value = v;
  });
  renderNotifyBtn();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('installHint').hidden = !(ios && !standalone);
  renderBackupStatus();
}

async function renderBackupStatus() {
  const { at, count } = state.backup;
  const unsaved = state.mons.length - count;
  let text = at
    ? `上次備份：${new Date(at).toLocaleDateString('zh-TW')}${unsaved > 0 ? `，之後又多了 ${unsaved} 隻` : '，目前是最新的'}。`
    : '還沒備份過。';
  const persisted = await navigator.storage?.persisted?.();
  text += persisted ? '瀏覽器已同意不自動清除資料。' : '把網頁加到主畫面可以降低資料被清掉的機率。';
  text += '序號請存在手機以外的地方（傳給自己、記事本、雲端），換手機也能還原。';
  $('backupStatus').textContent = text;
}

function markBackup() {
  state.backup = { at: Date.now(), count: state.mons.length };
  persist();
  renderBackupStatus();
}

function renderNotifyBtn() {
  const status = notifyStatus();
  const btn = $('notifyBtn');
  btn.textContent = { granted: '已開啟', denied: '被封鎖了', unsupported: '不支援', default: '開啟' }[status];
  btn.disabled = status !== 'default';
}

document.querySelectorAll('[data-setting]').forEach((input) => {
  input.addEventListener('change', () => {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') state.settings[key] = input.checked;
    else {
      const n = Math.round(Number(input.value));
      const v = Number.isFinite(n) ? Math.min(Number(input.max), Math.max(Number(input.min), n)) : state.settings[key];
      state.settings[key] = v;
      input.value = v;
    }
    state.settingsAt = Date.now();
    persist();
    if (key === 'wakeLock') keepAwake(state.settings.wakeLock);
    render();
  });
});

$('notifyBtn').addEventListener('click', async () => {
  await requestNotify();
  renderNotifyBtn();
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([exportData(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pomomon-backup-${dayKey()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  markBackup();
});

// 同一個對話框：mode = 'copy' 顯示序號；'restore' 讓使用者貼上
let codeMode = 'copy';

function openCodeDialog(mode, code = '') {
  codeMode = mode;
  const copy = mode === 'copy';
  $('codeTitle').textContent = copy ? '你的備份序號' : '用序號還原';
  $('codeHint').textContent = copy
    ? `包含 ${state.mons.length} 隻寶可夢、圖鑑和紀錄。複製後傳給自己或存到記事本，換手機時貼回來就能還原。`
    : '把之前存的序號整段貼上。還原後目前的資料會被取代。';
  $('codeText').value = code;
  $('codeText').readOnly = copy;
  $('codeText').placeholder = copy ? '' : 'PKMN1-…';
  $('codeAction').textContent = copy ? '複製' : '還原';
  $('codeShare').hidden = !(copy && navigator.share);
  $('codeDialog').showModal();
  if (!copy) $('codeText').focus();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 舊瀏覽器：選取後用 execCommand
    $('codeText').select();
    return document.execCommand?.('copy') ?? false;
  }
}

$('copyCodeBtn').addEventListener('click', async () => {
  openCodeDialog('copy', await encodeSave(state));
});

$('restoreCodeBtn').addEventListener('click', () => openCodeDialog('restore'));

$('codeShare').addEventListener('click', async () => {
  try {
    await navigator.share({ title: '寶可夢專注鐘 備份序號', text: $('codeText').value });
    markBackup();
    $('codeDialog').close();
  } catch {}
});

$('codeAction').addEventListener('click', async () => {
  const code = $('codeText').value;
  if (codeMode === 'copy') {
    if (await copyText(code)) {
      markBackup();
      $('codeDialog').close();
      toast('已複製序號，記得貼到安全的地方保存');
    } else {
      $('codeText').select();
      toast('沒辦法自動複製，請長按文字手動複製');
    }
    return;
  }
  try {
    const next = await decodeSave(code);
    if (!confirm(`序號裡有 ${next.mons.length} 隻寶可夢。要用它取代目前的資料嗎？`)) return;
    state = next;
    persist();
    location.reload();
  } catch (err) {
    toast(`還原失敗：${err.message}`);
  }
});

$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const next = importData(await file.text());
    if (!confirm(`要用備份取代目前的資料嗎？（備份裡有 ${next.mons.length} 隻寶可夢）`)) return;
    state = next;
    persist();
    location.reload();
  } catch (err) {
    toast(`匯入失敗：${err.message}`);
  }
});

$('resetBtn').addEventListener('click', async () => {
  const msg = user
    ? '要清除這台裝置上的資料並登出嗎？帳號裡的寶可夢不會被刪除，重新登入就會回來。'
    : '真的要清除所有寶可夢和紀錄嗎？這無法復原。';
  if (!confirm(msg)) return;
  if (!user && !confirm('再確認一次：全部清除？')) return;
  if (user) await signOut();
  try {
    localStorage.removeItem(LINK_KEY);
  } catch {}
  resetData();
  location.reload();
});

// ---------- 帳號同步 ----------

function applyState(next) {
  state = { ...next, timer: state.timer };
  save(state);
  field.sync(state.mons);
  render();
}

function onUser(u) {
  user = u;
  let linkedUid = null;
  try {
    linkedUid = localStorage.getItem(LINK_KEY);
  } catch {}
  linked = Boolean(u) && linkedUid === u.uid;
  setSyncStatus(u ? 'syncing' : '');
  renderAccount();
}

function onRemote(json, u) {
  if (!user || u.uid !== user.uid) return;
  if (busy) {
    pendingRemote = [json, u];
    return;
  }
  if (!linked) {
    linkAccount(json, u);
    return;
  }
  if (json == null) {
    // 雲端還是空的（例如被刪掉了），把這台的資料傳上去
    pushNow(u.uid, toJson(state), mergeJson).catch(() => setSyncStatus('error'));
    return;
  }
  markRemote(json);
  const remote = parseRemote(json);
  const merged = joinSaves(state, remote);
  if (!sameSave(merged, state)) applyState(merged);
  if (!sameSave(merged, remote)) schedulePush(u.uid, toJson(merged), mergeJson);
}

// 第一次在這台登入：決定這台原有的資料要怎麼繼承
async function linkAccount(json, u) {
  if (linking) return;
  linking = true;
  const remote = json ? parseRemote(json) : null;
  let next;
  if (!remote) {
    next = state;
    if (state.mons.length) toast(`已把這台的 ${state.mons.length} 隻寶可夢繼承到帳號`);
  } else if (!hasExtraMons(state, remote)) {
    // 這台沒有帳號裡沒有的寶可夢，直接合併就好
    next = joinSaves(state, remote);
    toast(`已載入帳號裡的 ${remote.mons.length} 隻寶可夢`);
  } else {
    $('inheritText').textContent =
      `這台裝置有 ${state.mons.length} 隻寶可夢，帳號裡有 ${remote.mons.length} 隻。` +
      '合併會保留兩邊所有的寶可夢；只用帳號的資料，這台原本的寶可夢會被取代。';
    await openDialog($('inherit'));
    if ($('inherit').returnValue === 'cloud') {
      try {
        localStorage.setItem(BEFORE_LINK_KEY, JSON.stringify(state));
      } catch {}
      next = remote;
      toast('已換成帳號裡的資料');
    } else {
      next = joinSaves(state, remote);
      toast(`合併完成，現在一共有 ${next.mons.length} 隻寶可夢`);
    }
  }
  try {
    localStorage.setItem(LINK_KEY, u.uid);
  } catch {}
  linked = true;
  linking = false;
  applyState(next);
  try {
    await pushNow(u.uid, toJson(state), mergeJson);
  } catch {
    setSyncStatus('error');
  }
}

let syncStatus = '';
function setSyncStatus(status) {
  syncStatus = status;
  const label = {
    syncing: '同步中…',
    synced: '已同步 ✓',
    offline: '離線中，連上網路後會自動同步',
    error: '同步失敗，稍後會再試',
  }[status] ?? '';
  $('syncStatus').textContent = label;
  $('syncStatus').dataset.status = status;
}

function renderAccount() {
  $('accountSection').hidden = !syncAvailable();
  $('accountOut').hidden = Boolean(user);
  $('accountIn').hidden = !user;
  if (user) $('accountEmail').textContent = user.email;
}

async function authAction(fn, btn) {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email) {
    toast('請輸入 Email');
    return;
  }
  btn.disabled = true;
  try {
    await fn(email, password);
    $('authPassword').value = '';
  } catch (err) {
    toast(authMessage(err));
  } finally {
    btn.disabled = false;
  }
}

$('signInBtn').addEventListener('click', (e) => authAction(signIn, e.currentTarget));
$('signUpBtn').addEventListener('click', (e) => authAction(signUp, e.currentTarget));
$('signOutBtn').addEventListener('click', async () => {
  if (!confirm('要登出嗎？這台的寶可夢會留著，但不會再自動同步。')) return;
  await signOut();
  toast('已登出');
});
$('forgotBtn').addEventListener('click', async () => {
  const email = $('authEmail').value.trim();
  if (!email) {
    toast('先在上面輸入你的 Email');
    return;
  }
  try {
    await resetPassword(email);
    toast('已寄出重設密碼的信，請到信箱查看');
  } catch (err) {
    toast(authMessage(err));
  }
});
$('inherit').addEventListener('cancel', (e) => e.preventDefault());

window.addEventListener('online', () => {
  if (user && linked) schedulePush(user.uid, toJson(state), mergeJson);
});

// ---------- 按鈕 ----------

$('mainBtn').addEventListener('click', async () => {
  unlockAudio();
  if (!state.timer) {
    if (notifyStatus() === 'default') await requestNotify();
    startTimer('focus');
  } else {
    // 休息中：跳過
    state.timer = null;
    persist();
    render();
  }
});

$('altBtn').addEventListener('click', () => {
  if (confirm('要放棄這次專注嗎？這次不會得到寶可夢。')) failFocus('你放棄了這次專注。休息一下再來吧！');
});

$('openCollection').addEventListener('click', () => {
  renderParty();
  renderDex();
  $('collection').showModal();
});

$('openSettings').addEventListener('click', () => {
  renderSettings();
  $('settings').showModal();
});

document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));
document.querySelectorAll('dialog.full').forEach((dlg) => {
  // 點背景關閉
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
});
$('rewardOk').addEventListener('click', () => $('reward').close());
$('evoOk').addEventListener('click', () => $('evolve').close());
$('failOk').addEventListener('click', () => $('fail').close());
// 獎勵動畫期間不能用返回鍵跳過
for (const id of ['reward', 'evolve']) $(id).addEventListener('cancel', (e) => e.preventDefault());

document.addEventListener('pointerdown', unlockAudio, { once: true });

// ---------- 啟動 ----------

field.sync(state.mons);
keepAwake(state.settings.wakeLock);
checkReturn();
render();
setInterval(tick, 250);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
// 請瀏覽器不要在空間不足時清掉存檔
navigator.storage?.persist?.().catch(() => {});

renderAccount();
if (syncAvailable()) {
  startSync({ onUser, onRemote, onStatus: setSyncStatus }).catch(() => setSyncStatus('error'));
}
