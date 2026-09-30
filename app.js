'use strict';

/* ============================================================
 * 媒体播放策略实验室
 * 纯原生 JS，不使用任何框架。
 * 模块：环境检测 / 自动播放尝试与归因 / 播放状态 /
 *       Permissions + MediaDevices / Picture-in-Picture 降级 /
 *       Media Session 降级 / IndexedDB 日志
 * ============================================================ */

/* ---------- 小工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (typeof v === 'boolean') { if (v) node.setAttribute(k, ''); }
      else node.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of children) node.appendChild(c);
  }
  return node;
}

function nowTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ---------- IndexedDB 日志持久化 ---------- */
const DB_NAME = 'media-lab-db';
const DB_VERSION = 1;
const STORE_LOGS = 'logs';
const STORE_META = 'meta';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_LOGS)) {
        db.createObjectStore(STORE_LOGS, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function dbPut(store, value, key) {
  const db = await openDB();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function dbClear(store) {
  const db = await openDB();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/* ---------- 日志系统（同时写 DOM 与 IndexedDB） ---------- */
const memoryLogs = []; // IndexedDB 不可用时的内存降级
const LEVEL_LABEL = { info: 'INFO', ok: 'OK', warn: 'WARN', error: 'ERROR', block: 'BLOCK' };

async function log(level, msg, detail) {
  const entry = { time: nowTime(), level, msg: String(msg), detail: detail ? String(detail) : '' };
  memoryLogs.push(entry);
  renderLogEntry(entry);
  const ok = await dbPut(STORE_LOGS, entry);
  if (!ok) setDbState('IndexedDB：不可用（file:// 或被禁用），日志仅保存在内存');
  return entry;
}

function renderLogEntry(entry) {
  const list = $('#logList');
  const li = el('li', { 'data-level': entry.level });
  li.appendChild(el('span', { class: 'log-time', text: entry.time }));
  li.appendChild(el('span', { class: `log-level ${entry.level}`, text: LEVEL_LABEL[entry.level] || entry.level }));
  const main = el('span', { class: 'log-msg', text: entry.msg });
  if (entry.detail) main.appendChild(el('span', { class: 'log-detail', text: ' — ' + entry.detail }));
  li.appendChild(main);
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
  applyLogFilter();
}

function applyLogFilter() {
  const filter = $('#logLevelFilter').value;
  for (const li of $$('#logList li')) {
    li.style.display = (filter === 'all' || li.dataset.level === filter) ? '' : 'none';
  }
}

function setDbState(text) {
  const node = $('#dbState');
  if (node) node.textContent = text;
}

async function restoreLogs() {
  const db = await openDB();
  if (!db) {
    setDbState('IndexedDB：不可用，使用内存日志（降级）');
  } else {
    setDbState('IndexedDB：可用，日志已持久化');
  }
  const rows = await dbGetAll(STORE_LOGS);
  const list = $('#logList');
  list.textContent = '';
  if (rows.length === 0) {
    for (const entry of memoryLogs) renderLogEntry(entry);
  } else {
    memoryLogs.length = 0;
    memoryLogs.push(...rows);
    rows.slice(-100).forEach(renderLogEntry);
  }
}

/* ---------- 环境与用户激活检测 ---------- */
function setFeat(containerSel, key, state, text) {
  const slot = document.querySelector(`${containerSel} .feat[data-feat="${key}"] [data-state]`);
  if (!slot) return;
  slot.dataset.state = state;
  slot.textContent = text;
}

function activationSnapshot() {
  const ua = navigator.userActivation;
  if (!ua) return { hasApi: false, sticky: 'unknown', transient: false };
  return {
    hasApi: true,
    sticky: !!ua.hasBeenActive,
    transient: !!ua.isActive
  };
}

function refreshEnvironment() {
  const secure = window.isSecureContext;
  setFeat('#envGrid', 'secure', secure ? 'ok' : 'warn',
    secure ? '是（isSecureContext=true）' : '否（非安全上下文）');
  setFeat('#envGrid', 'protocol', 'info', location.protocol || '(空)');

  const ua = navigator.userActivation;
  setFeat('#envGrid', 'autoplay', ua ? 'ok' : 'warn',
    ua ? '支持' : '不支持（用启发式判断）');

  const snap = activationSnapshot();
  setFeat('#envGrid', 'sticky', snap.sticky === true ? 'ok' : (snap.sticky === false ? 'warn' : 'info'),
    snap.sticky === true ? '已激活（用户交互过）'
      : snap.sticky === false ? '未激活（本会话尚无用户手势）' : '未知（浏览器不提供）');
  setFeat('#envGrid', 'transient', snap.transient ? 'ok' : 'warn',
    snap.transient ? '瞬时激活中（~5s 窗口）' : '无瞬时激活');

  let hint;
  if (!secure && location.protocol === 'http:' && location.hostname) {
    hint = { s: 'warn', t: 'HTTP 页面：getUserMedia / 权限 API 可能不可用' };
  } else if (!secure) {
    hint = { s: 'warn', t: '非安全上下文：部分媒体能力会被禁用' };
  } else if (location.protocol === 'file:') {
    hint = { s: 'info', t: 'file:// 在 Chrome 中视为安全上下文；IndexedDB 可能受限' };
  } else if (ua && !ua.hasBeenActive) {
    hint = { s: 'info', t: '页面加载即自动播放：此刻没有任何用户手势，最能暴露自动播放策略' };
  } else {
    hint = { s: 'ok', t: '环境正常；可点“加载并尝试自动播放”对比手势前后差异' };
  }
  setFeat('#envGrid', 'hint', hint.s, hint.t);
}


/* ---------- 内置媒体源 ---------- */
function makeDemoWavUrl() {
  // 生成 3 秒 440Hz 正弦音 WAV（离线可用，不依赖网络）
  const sampleRate = 22050;
  const seconds = 3;
  const n = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); writeStr(8, 'WAVE');
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); writeStr(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const envelope = Math.min(1, i / 2000, (n - i) / 2000);
    view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 0.25 * 32767 * envelope, true);
  }
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
}

const SOURCES = [
  { id: 'local-audio', label: '本地内置音频（离线生成的 440Hz WAV）', kind: 'audio', get url() { return makeDemoWavUrl(); } },
  { id: 'mdn-video', label: '在线视频 · MDN 示例 (flowers.mp4)', kind: 'video',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
  { id: 'gvideo', label: '在线视频 · Google 示例 (chrome.mp4)', kind: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4' },
  { id: 'gaudio', label: '在线音频 · Google 示例 (mp3)', kind: 'audio',
    url: 'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3' }
];

function populateSources() {
  const select = $('#sourceSelect');
  for (const s of SOURCES) {
    select.appendChild(el('option', { value: s.id, text: s.label }));
  }
}

/* ---------- 特性检测 ---------- */
const features = {
  permissions: typeof navigator !== 'undefined' && 'permissions' in navigator && !!navigator.permissions && typeof navigator.permissions.query === 'function',
  mediaDevices: typeof navigator !== 'undefined' && !!navigator.mediaDevices,
  getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  pip: typeof document !== 'undefined' && 'pictureInPictureEnabled' in document,
  mediaSession: typeof navigator !== 'undefined' && 'mediaSession' in navigator
};

function detectFeatures() {
  // 画中画
  const pipEnabled = features.pip ? document.pictureInPictureEnabled : false;
  setFeat('#pipCard', 'pip',
    !features.pip ? 'no' : pipEnabled ? 'ok' : 'warn',
    !features.pip ? '不支持（无此 API）'
      : pipEnabled ? '可用'
      : '存在 API 但被禁用（Permissions-Policy: picture-in-picture）');

  // 媒体会话
  setFeat('#sessionCard', 'ms', features.mediaSession ? 'ok' : 'no',
    features.mediaSession ? '存在 navigator.mediaSession' : '不支持（无此 API）');
  const msActionsOk = features.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function';
  setFeat('#sessionCard', 'msactions', msActionsOk ? 'ok' : 'no',
    msActionsOk ? '支持' : '不支持');
  $('#msBtn').disabled = !msActionsOk;

  // 环境卡补充
  const envExtra = {
    permissions: features.permissions, mediaDevices: features.mediaDevices,
    getUserMedia: features.getUserMedia
  };
  for (const [k, v] of Object.entries(envExtra)) {
    let slot = document.querySelector(`#envGrid .feat[data-feat="${k}"] [data-state]`);
    if (!slot) {
      // 动态补一行
      const wrap = document.querySelector('#envGrid');
      const f = el('div', { class: 'feat', 'data-feat': k });
      f.appendChild(el('span', { class: 'feat-label', text: k }));
      slot = el('span', { class: 'feat-state' });
      slot.setAttribute('data-state', v ? 'ok' : 'warn');
      f.appendChild(slot);
      wrap.appendChild(f);
    }
    slot.dataset.state = v ? 'ok' : 'warn';
    slot.textContent = v ? '支持' : '不支持 / 非安全上下文下被禁用';
  }
}

/* ---------- 媒体加载与自动播放尝试 ---------- */
const state = {
  media: null,
  kind: null,
  src: null,
  srcIsBlob: false,
  sourceLabel: '',
  bound: false,
  mutedFallbackUsed: false
};

function revokeCurrentSrc() {
  if (state.srcIsBlob && state.src) {
    try { URL.revokeObjectURL(state.src); } catch (e) { /* 忽略 */ }
  }
  state.src = null;
  state.srcIsBlob = false;
}

function addStep(html) {
  const li = el('li');
  li.innerHTML = html;
  $('#diagSteps').appendChild(li);
  return li;
}

function resetDiag() {
  $('#diagSteps').textContent = '';
  const v = $('#diagVerdict');
  v.className = 'verdict hidden';
  v.textContent = '';
  $('#retryBtn').classList.add('hidden');
}

const MEDIA_ERR = {
  1: 'MEDIA_ERR_ABORTED（加载被中止）',
  2: 'MEDIA_ERR_NETWORK（网络错误）',
  3: 'MEDIA_ERR_DECODE（解码失败）',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED（源不支持/地址无法访问/CORS 拦截）'
};

function showMediaError(err) {
  const box = $('#mediaError');
  box.classList.remove('hidden');
  const code = err && err.code;
  box.textContent = '媒体错误：' + (MEDIA_ERR[code] || (err && err.message) || '未知错误');
}

function clearMediaError() {
  $('#mediaError').classList.add('hidden');
  $('#mediaError').textContent = '';
}

function buildMediaElement(kind, src) {
  const media = document.createElement(kind);
  media.preload = 'auto';
  media.controls = true;
  media.playsInline = true;
  media.setAttribute('playsinline', '');
  if (kind === 'video') {
    media.muted = false;
  }
  media.src = src;
  return media;
}

function bindMediaEvents(media) {
  if (state.bound) return;
  state.bound = true;
  const events = ['play', 'playing', 'pause', 'ended', 'volumechange', 'mute',
    'waiting', 'canplay', 'loadedmetadata', 'error', 'ratechange'];
  for (const name of events) {
    media.addEventListener(name, () => {
      if (name !== 'timeupdate') {
        log('info', `媒体事件：${name}`,
          name === 'error' && media.error ? MEDIA_ERR[media.error.code] : '');
      }
      if (name === 'error' && media.error) showMediaError(media.error);
      updateStateChips();
    });
  }
}

function updateStateChips() {
  const m = state.media;
  if (!m) return;
  const playChip = $('#chipPlayback');
  let label;
  if (m.ended) label = ['ended', '已结束'];
  else if (m.paused) label = ['paused', '已暂停'];
  else if (m.readyState < 3) label = ['', '缓冲中…'];
  else label = ['playing', '播放中'];
  playChip.textContent = '播放状态：' + label[1];
  playChip.className = 'chip ' + label[0];

  const muteChip = $('#chipMuted');
  muteChip.textContent = `静音：${m.muted ? '是' : '否'}（音量 ${m.volume.toFixed(2)}）`;
  muteChip.className = 'chip ' + (m.muted ? 'muted-on' : '');

  $('#chipReady').textContent = 'readyState：' + m.readyState;
  $('#chipNetwork').textContent = 'networkState：' + m.networkState;
}

async function loadAndTryAutoplay({ src, kind, label, isBlob, persistMeta }) {
  revokeCurrentSrc();
  clearMediaError();
  resetDiag();
  state.mutedFallbackUsed = false;

  // 重建媒体元素
  const stage = $('#mediaStage');
  stage.textContent = '';
  $('#miniBody').textContent = '';
  $('#miniFallback').classList.add('hidden');
  if (state.media) {
    try { state.media.pause(); } catch (e) { /* 忽略 */ }
    state.media.removeAttribute('src');
    state.media.remove();
  }
  state.bound = false;
  $('#pipBtn').textContent = '进入画中画';
  const media = buildMediaElement(kind, src);
  state.media = media;
  state.kind = kind;
  state.src = src;
  state.srcIsBlob = !!isBlob;
  state.sourceLabel = label;
  stage.appendChild(media);
  bindMediaEvents(media);
  bindPipEvents();
  if (msRegistered) {
    media.addEventListener('play', syncMediaSessionPlayback);
    media.addEventListener('pause', syncMediaSessionPlayback);
    syncMediaSessionPlayback();
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: label, artist: 'Media Lab（本地演示）', album: 'Autoplay / Permission / PiP 实验'
      });
    } catch (e) { /* 忽略 */ }
  }
  $('#controlRow').hidden = false;
  $('#playBtn').textContent = '手动播放';
  $('#muteBtn').textContent = '静音';
  $('#volume').value = media.volume;

  log('info', `加载媒体：${label}`, `${kind} · ${isBlob ? 'blob URL' : src}`);
  addStep(`<strong>1. 创建 ${kind} 元素</strong>，设置 src（<small>preload=auto, playsInline, 初始 unmuted）</small>`);

  media.load();

  if (persistMeta) {
    dbPut(STORE_META, { id: persistMeta.id, kind, label, src: isBlob ? null : src, isBlob: false }, 'lastSource');
  }

  // 自动播放尝试：unmuted 先行，失败后按策略降级
  await tryAutoplay(media);
  updatePipAvailability();
}

/* 调用 play() 并把“同步抛错 / Promise reject / 超时”全部归一化 */
function invokePlay(media) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, timeout: true, error: null });
    }, 8000);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let p;
    try {
      p = media.play();
    } catch (e) {
      finish({ ok: false, timeout: false, error: e });
      return;
    }
    if (p && typeof p.then === 'function') {
      p.then(
        () => finish({ ok: true, timeout: false, error: null }),
        (e) => finish({ ok: false, timeout: false, error: e || new Error('rejected') })
      );
    } else {
      // 极老浏览器：没有 Promise，用事件粗略判断
      finish({ ok: !media.paused, timeout: false, error: media.paused ? new Error('play() 未返回 Promise 且仍处于暂停') : null });
    }
  });
}

function classifyError(error, hadGesture) {
  if (!error) return { type: 'unknown', name: '未知错误' };
  const name = (error.name || 'Error');
  const msg = String(error.message || '');
  if (name === 'NotAllowedError' || /not allowed|user gesture|autoplay|play\(\) request|gesture/i.test(msg)) {
    return {
      type: hadGesture ? 'block-gesture' : 'block-nogesture',
      name: 'NotAllowedError（自动播放被浏览器策略阻止）'
    };
  }
  if (name === 'NotSupportedError') return { type: 'source', name: 'NotSupportedError（媒体源无法播放/解码）' };
  if (name === 'AbortError') return { type: 'abort', name: 'AbortError（播放被中止，可能是切换源）' };
  if (name === 'SecurityError') return { type: 'security', name: 'SecurityError（安全策略阻止，常见于非安全上下文/CORS）' };
  if (name === 'InvalidStateError') return { type: 'state', name: 'InvalidStateError（元素状态无效）' };
  return { type: 'unknown', name: `${name}：${msg || '无错误消息'}` };
}

async function tryAutoplay(media) {
  const before = activationSnapshot();
  addStep(`<strong>2. 尝试带声自动播放</strong>（<small>此时 transient activation=${before.transient}，sticky=${before.sticky}</small>）`);
  log(before.transient ? 'info' : 'warn',
    `调用 play() 前的用户激活状态：transient=${before.transient}, sticky=${before.sticky}`,
    '没有瞬时激活时，带声自动播放通常会被 Autoplay Policy 拦截');

  const first = await invokePlay(media);
  if (first.ok && !media.paused) {
    addStep(`<strong>3. play() 成功</strong>：浏览器允许了${before.transient ? '（用户手势内）' : '（自动播放策略豁免：静音 / 媒体参与度 / MEI / 白名单）'}`);
    renderVerdict({
      cls: 'v-ok',
      title: before.transient ? '✅ 播放成功（在用户手势内）' : '✅ 自动播放被允许（带声）',
      reason: `原因：play() 返回的 Promise 已 resolve，媒体正在播放。当前环境的自动播放策略允许带声播放` +
        (before.transient ? '，因为调用发生在用户瞬时激活窗口内。' : '（可能用户此前与站点有充分的媒体互动 MEI，或浏览器/站点处于白名单）。'),
      advice: '无需降级，原生控件与自定义控件都可用。'
    });
    log('ok', '自动播放成功（带声）', 'play() resolved');
    return;
  }

  // 失败归因
  const reason = first.timeout
    ? { type: 'timeout', name: 'play() Promise 长时间未 resolve（媒体可能未加载完成或被挂起）' }
    : classifyError(first.error, before.transient);

  addStep(`<strong>3. 带声 play() 被拒绝</strong>：<small>${reason.name}</small>`);
  log('block', '带声自动播放被阻止', reason.name);

  // 4. 静音自动播放降级（标准 Autoplay Policy：muted autoplay 普遍允许）
  addStep('<strong>4. 执行静音自动播放降级</strong>：<small>设置 media.muted=true 后重试 play()</small>');
  media.muted = true;
  const muted = await invokePlay(media);
  if (muted.ok && !media.paused) {
    state.mutedFallbackUsed = true;
    addStep('<strong>5. 静音重试成功</strong>：<small>这是标准“静音自动播放”降级，用户可手动取消静音</small>');
    renderVerdict({
      cls: 'v-block',
      title: '🔇 自动播放被阻止 → 已降级为静音自动播放',
      reason: `阻止原因：${reason.name}。带声自动播放需要用户激活（user activation）或足够的媒体互动指数 (MEI)；` +
        (before.transient
          ? '本次调用虽在手势窗口内仍被拒，可能是浏览器策略更严格。'
          : '本次调用发生在页面加载阶段、用户尚未与页面交互，transient/sticky activation 均不满足。'),
      advice: '页面正在以静音方式播放；用户点击“取消静音”或“手动播放”即可恢复带声播放。'
    });
    log('warn', '静音自动播放降级成功', 'muted retry resolved');
    updateStateChips();
    return;
  }

  // 5. 连静音也不允许 → 手动播放降级
  const mutedReason = muted.timeout
    ? { name: '静音重试同样超时（多半是媒体源加载失败）' }
    : classifyError(muted.error, before.transient);
  addStep(`<strong>5. 静音重试也未成功</strong>：<small>${mutedReason.name}</small>`);

  const isSourceProblem = reason.type === 'source' || reason.type === 'timeout' ||
    mutedReason.type === 'source' || mutedReason.type === 'timeout' || (media.error && media.error.code >= 2);
  if (isSourceProblem) {
    renderVerdict({
      cls: 'v-error',
      title: '❌ 无法播放：更像是媒体源问题而非自动播放策略',
      reason: `判定依据：${reason.name}${mutedReason.name !== reason.name ? '；静音重试：' + mutedReason.name : ''}。` +
        '自动播放策略拦截通常在“静音重试”时放行；静音也失败说明地址不可达、格式不支持、CORS 拦截或解码失败。',
      advice: '更换媒体源 / 检查网络与控制台；媒体元素自带控件，源可用后点“手动播放”即可（最终仍降级为手动播放）。'
    });
    log('error', '播放失败：疑似媒体源问题', mutedReason.name);
  } else {
    renderVerdict({
      cls: 'v-warn',
      title: '🟡 自动播放被阻止且静音降级也未生效 → 已降级为手动播放',
      reason: `阻止原因：${reason.name}。部分浏览器（尤其 iOS Safari 低电量模式/严格策略）连 muted.play() 也要求手势。`,
      advice: '请点击“手动播放”按钮或媒体原生控件——该点击是真实用户激活，play() 会被允许。'
    });
    log('warn', '降级为手动播放（等待用户手势）', reason.name);
  }
  $('#retryBtn').classList.remove('hidden');
}

function renderVerdict({ cls, title, reason, advice }) {
  const v = $('#diagVerdict');
  v.className = 'verdict ' + cls;
  v.textContent = '';
  v.appendChild(el('span', { class: 'v-title', text: title }));
  v.appendChild(el('span', { class: 'v-reason', text: reason }));
  if (advice) v.appendChild(el('span', { class: 'v-advice', text: '建议：' + advice }));
}

/* ---------- 播放控件（降级后的手动播放必须可用） ---------- */
function bindControls() {
  $('#playBtn').addEventListener('click', async () => {
    const media = state.media;
    if (!media) return;
    // 用户真实点击 → transient activation 生效
    if (state.mutedFallbackUsed || media.muted) {
      media.muted = false;
      log('info', '用户取消静音');
    }
    addStep('<strong>6. 用户点击“手动播放”</strong>：<small>真实用户手势，浏览器允许 play()</small>');
    const r = await invokePlay(media);
    if (r.ok) {
      log('ok', '手动播放成功（用户手势内）');
      renderVerdict({
        cls: 'v-ok',
        title: '✅ 手动播放成功',
        reason: '原因：点击发生在用户瞬时激活窗口（transient activation），Autoplay Policy 不再阻止。',
        advice: '这证明“降级到手动播放”路径可用：自动播放被拒并不影响后续手势播放。'
      });
    } else {
      const why = classifyError(r.error, true);
      log('error', '手动播放也失败', why.name);
      renderVerdict({
        cls: 'v-error',
        title: '❌ 手动播放失败',
        reason: why.name + '。即使在用户手势内仍被拒，通常意味着媒体源本身有问题。',
        advice: '更换媒体源后重试。'
      });
    }
    updateStateChips();
  });

  $('#muteBtn').addEventListener('click', () => {
    const media = state.media;
    if (!media) return;
    media.muted = !media.muted;
    log('info', media.muted ? '已静音' : '已取消静音');
    updateStateChips();
  });

  $('#volume').addEventListener('input', (e) => {
    const media = state.media;
    if (!media) return;
    media.volume = parseFloat(e.target.value);
    if (media.volume > 0 && media.muted) media.muted = false;
    updateStateChips();
  });

  $('#retryBtn').addEventListener('click', () => {
    if (!state.media) return;
    log('info', '重新尝试自动播放');
    resetDiag();
    tryAutoplay(state.media);
  });
}

/* ---------- Permissions API + MediaDevices ---------- */
const PERMISSIONS = [
  { key: 'microphone', name: '麦克风', media: { audio: true } },
  { key: 'camera', name: '摄像头', media: { video: true } }
];
const activeStreams = {};

function buildPermissionCards() {
  const list = $('#permList');
  for (const p of PERMISSIONS) {
    const item = el('div', { class: 'perm-item', id: `perm-${p.key}` });
    const top = el('div', { class: 'perm-top' });
    top.appendChild(el('span', { class: 'perm-name', text: p.name }));
    top.appendChild(el('span', { class: 'perm-status', id: `perm-status-${p.key}`, text: '未查询' }));
    item.appendChild(top);
    item.appendChild(el('p', { class: 'perm-detail', id: `perm-detail-${p.key}` }));
    const actions = el('div', { class: 'perm-actions' });
    const queryBtn = el('button', { type: 'button', text: '查询状态 (Permissions.query)' });
    const reqBtn = el('button', { type: 'button', text: '申请权限 (getUserMedia)' });
    queryBtn.addEventListener('click', () => queryPermission(p));
    reqBtn.addEventListener('click', () => requestPermission(p));
    actions.appendChild(queryBtn);
    actions.appendChild(reqBtn);
    item.appendChild(actions);
    list.appendChild(item);
  }

  if (!window.isSecureContext) {
    $('#permNote').textContent =
      '⚠ 当前为非安全上下文（非 HTTPS / 非 localhost）：navigator.mediaDevices 通常为 undefined，权限申请会被禁用；' +
      '本页所有调用都做了特性检测，不会崩溃，只会给出明确提示。';
  } else if (!features.permissions) {
    $('#permNote').textContent =
      'ℹ 本浏览器不支持 Permissions API（如 Firefox/Safari 对部分权限不支持 query），将直接通过 getUserMedia 申请并按结果归因。';
  }
}

function setPermStatus(p, state2, detail) {
  const chip = $(`#perm-status-${p.key}`);
  chip.className = 'perm-status ' + state2;
  const map = {
    granted: 'granted：已授权',
    denied: 'denied：已拒绝',
    prompt: 'prompt：待询问',
    unsupported: 'unsupported：不支持查询',
    insecure: 'insecure：非安全上下文'
  };
  chip.textContent = map[state2] || state2;
  $(`#perm-detail-${p.key}`).textContent = detail || '';
}

async function queryPermission(p) {
  if (!window.isSecureContext) {
    setPermStatus(p, 'insecure', '非安全上下文：Permissions API 与 getUserMedia 被浏览器禁用。请通过 HTTPS 或 localhost 访问。');
    log('warn', `权限查询跳过：非安全上下文（${p.name}）`);
    return;
  }
  if (!features.permissions) {
    setPermStatus(p, 'unsupported', '浏览器不支持 navigator.permissions.query；可直接尝试 getUserMedia，由用户授权结果反推状态。');
    log('warn', `Permissions.query 不支持（${p.name}），降级为直接申请`);
    return;
  }
  try {
    const result = await navigator.permissions.query({ name: p.key });
    setPermStatus(p, result.state, `Permissions.query 返回 state="${result.state}"，onchange 监听已挂载。`);
    log('info', `${p.name} 权限状态：${result.state}`);
    result.onchange = () => {
      setPermStatus(p, result.state, `权限状态发生变化 → state="${result.state}"（onchange）`);
      log('info', `${p.name} 权限变化：${result.state}`);
    };
  } catch (e) {
    setPermStatus(p, 'unsupported', `query 抛错：${e.name}：${e.message || ''}。Firefox 对麦克风/摄像头查询会抛 TypeError，属预期。`);
    log('warn', `${p.name} query 失败（降级）：${e.name}`);
  }
}

async function requestPermission(p) {
  if (!window.isSecureContext) {
    setPermStatus(p, 'insecure', '非安全上下文：无法申请。getUserMedia 仅在安全上下文中存在。');
    log('error', `getUserMedia 未调用：非安全上下文（${p.name}）`);
    return;
  }
  if (!features.getUserMedia) {
    setPermStatus(p, 'unsupported', 'navigator.mediaDevices.getUserMedia 不存在（非安全上下文或浏览器不支持）。');
    log('error', `${p.name}：getUserMedia API 不存在，已降级提示`);
    return;
  }
  log('info', `申请权限：${p.key}（调用发生时 transient activation=${activationSnapshot().transient}）`);
  try {
    const stream = await navigator.mediaDevices.getUserMedia(p.media);
    activeStreams[p.key] = stream;
    setPermStatus(p, 'granted',
      `getUserMedia 成功，获得 ${stream.getTracks().length} 个轨道；轨道已保留（可停止）。`);
    log('ok', `${p.name} 授权成功`, stream.getTracks().map(t => t.label).join(', '));
    queryPermission(p);
  } catch (e) {
    handlePermissionError(p, e);
  }
}

function handlePermissionError(p, e) {
  const name = e.name || 'Error';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    setPermStatus(p, 'denied',
      `${name}：用户拒绝或浏览器策略禁止。被拒后浏览器通常不再弹授权框，需要用户在站点设置中手动恢复。`);
    log('error', `${p.name} 被拒绝（${name}）`, '已给出明确提示，不影响播放等其它功能');
  } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    setPermStatus(p, 'denied', `${name}：未检测到${p.name}设备。`);
    log('warn', `${p.name}：无设备（${name}）`);
  } else if (name === 'NotReadableError') {
    setPermStatus(p, 'denied', `${name}：设备存在但被其它应用占用。`);
    log('warn', `${p.name}：设备被占用（${name}）`);
  } else if (name === 'OverconstrainedError') {
    setPermStatus(p, 'denied', `${name}：约束条件无法满足。`);
    log('warn', `${p.name}：约束无法满足（${name}）`);
  } else {
    setPermStatus(p, 'unsupported', `${name}：${e.message || ''}`);
    log('error', `${p.name} 申请异常：${name}`, e.message);
  }
}

/* ---------- Picture-in-Picture（失败必须降级） ---------- */
let miniOpen = false;

function updatePipAvailability() {
  const btn = $('#pipBtn');
  const m = state.media;
  if (!m || state.kind !== 'video') {
    btn.disabled = true;
    $('#pipMsg').textContent = m && state.kind === 'audio'
      ? '当前媒体是音频，系统画中画不适用；可使用“页内降级小窗”。'
      : '加载视频后可尝试进入系统画中画。';
    return;
  }
  if (!features.pip) {
    btn.disabled = true;
    $('#pipMsg').textContent = '浏览器不支持 Picture-in-Picture API → 自动降级方案：页内小窗（右下角按钮）。';
    return;
  }
  if (!document.pictureInPictureEnabled) {
    btn.disabled = true;
    $('#pipMsg').textContent = 'API 存在但被 Permissions-Policy 禁用（picture-in-picture）→ 请使用页内小窗降级。';
    return;
  }
  btn.disabled = false;
  $('#pipMsg').textContent = '支持系统画中画。进入失败（如未加载元数据/被拒绝）会自动降级为页内小窗。';
}

async function togglePip() {
  const media = state.media;
  if (!media || state.kind !== 'video') return;
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      log('ok', '已退出画中画');
      return;
    }
    if (media.readyState < 1) {
      throw Object.assign(new Error('媒体尚未加载到可画中画的状态 (HAVE_METADATA)'), { name: 'InvalidStateError' });
    }
    log('info', '请求进入画中画', `transient activation=${activationSnapshot().transient}`);
    await media.requestPictureInPicture();
    log('ok', '已进入系统画中画');
  } catch (e) {
    const name = e.name || 'Error';
    log('error', `画中画失败：${name}`, e.message || '');
    $('#pipMsg').textContent =
      `画中画失败（${name}${e.message ? '：' + e.message : ''}）。已自动降级为页内小窗，播放不中断。`;
    openMiniFallback();
  }
}

function bindPipEvents() {
  const media = state.media;
  if (!media || media.__pipBound) return;
  media.__pipBound = true;
  media.addEventListener('enterpictureinpicture', () => {
    log('ok', '事件：enterpictureinpicture');
    $('#pipBtn').textContent = '退出画中画';
  });
  media.addEventListener('leavepictureinpicture', () => {
    log('info', '事件：leavepictureinpicture');
    $('#pipBtn').textContent = '进入画中画';
  });
}

function openMiniFallback() {
  if (!state.media) {
    $('#pipMsg').textContent = '请先加载媒体，再打开页内小窗。';
    return;
  }
  bindPipEvents();
  const body = $('#miniBody');
  // 把实际媒体元素移动进小窗：播放连续、状态真实，这是真正可用的降级
  body.appendChild(state.media);
  $('#miniFallback').classList.remove('hidden');
  miniOpen = true;
  log('warn', '画中画降级：媒体元素已移入页内小窗');
}

function closeMiniFallback() {
  if (state.media) $('#mediaStage').appendChild(state.media);
  $('#miniFallback').classList.add('hidden');
  miniOpen = false;
  log('info', '页内小窗已关闭，媒体回到主舞台');
}

/* ---------- Media Session（不支持必须降级） ---------- */
let msRegistered = false;
const MS_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward',
  'previoustrack', 'nexttrack', 'seekto'];

function syncMediaSessionPlayback() {
  if (!features.mediaSession || !state.media) return;
  try {
    navigator.mediaSession.playbackState = state.media.paused ? 'paused' : 'playing';
  } catch (e) { /* 忽略 */ }
}

function registerMediaSession() {
  if (!features.mediaSession || typeof navigator.mediaSession.setActionHandler !== 'function') {
    $('#msMsg').textContent = 'Media Session API 不支持 → 已降级：媒体元素原生控件 + 页面自定义控件照常可用，锁屏/耳机键控制不可用。';
    log('warn', 'Media Session 不支持，降级到普通控件');
    return;
  }
  const supported = [];
  const unsupported = [];
  for (const action of MS_ACTIONS) {
    try {
      navigator.mediaSession.setActionHandler(action, () => handleSessionAction(action));
      supported.push(action);
    } catch (e) {
      unsupported.push(action);
    }
  }
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.sourceLabel || '媒体播放策略实验室',
      artist: 'Media Lab（本地演示）',
      album: 'Autoplay / Permission / PiP 实验'
    });
  } catch (e) { /* 老浏览器无 MediaMetadata */ }
  msRegistered = true;
  $('#msMsg').textContent =
    `已注册动作处理器：${supported.join(', ')}` +
    (unsupported.length ? `；浏览器忽略（不支持）：${unsupported.join(', ')}。` : '。') +
    ' 可按键盘媒体键或锁屏控件测试；playbackState 已与播放状态联动。';
  log('ok', 'Media Session 注册完成', `支持=${supported.length}，不支持=${unsupported.length}`);

  if (state.media) {
    state.media.addEventListener('play', syncMediaSessionPlayback);
    state.media.addEventListener('pause', syncMediaSessionPlayback);
    syncMediaSessionPlayback();
  }
}

function handleSessionAction(action) {
  const media = state.media;
  log('info', `Media Session 动作：${action}`);
  if (!media) return;
  switch (action) {
    case 'play': media.muted = false; media.play().catch(() => {}); break;
    case 'pause': media.pause(); break;
    case 'stop': media.pause(); media.currentTime = 0; break;
    case 'seekbackward': media.currentTime = Math.max(0, media.currentTime - 10); break;
    case 'seekforward': media.currentTime = Math.min(media.duration || 0, media.currentTime + 10); break;
    case 'previoustrack': media.currentTime = 0; break;
    case 'nexttrack': media.currentTime = media.duration || 0; break;
    case 'seekto': break;
  }
}

/* ---------- 源选择 / 表单 ---------- */
function resolveSelection() {
  const custom = $('#customUrl').value.trim();
  const file = $('#fileInput').files && $('#fileInput').files[0];
  if (file) {
    const kind = file.type.startsWith('video/') ? 'video' : 'audio';
    return { src: URL.createObjectURL(file), kind, label: file.name, isBlob: true, persistMeta: null };
  }
  if (custom) {
    const ext = custom.toLowerCase().split(/[?#]/)[0];
    const kind = /\.(mp4|webm|ogv|mov|m4v)($|\.)/.test(ext) ? 'video'
      : /\.(mp3|wav|ogg|oga|m4a|aac|flac)($|\.)/.test(ext) ? 'audio'
      : 'audio';
    return { src: custom, kind, label: '自定义 URL：' + custom, isBlob: false,
      persistMeta: { id: 'custom', src: custom, kind, label: '自定义 URL：' + custom } };
  }
  const def = SOURCES.find((s) => s.id === $('#sourceSelect').value) || SOURCES[0];
  return { src: def.url, kind: def.kind, label: def.label, isBlob: def.id === 'local-audio',
    persistMeta: { id: def.id } };
}

function bindSourceForm() {
  $('#sourceForm').addEventListener('submit', (e) => {
    e.preventDefault();
    refreshEnvironment(); // 记录“点击后”的激活状态，便于对比
    const sel = resolveSelection();
    loadAndTryAutoplay(sel);
  });

  $('#fileInput').addEventListener('change', refreshEnvironment);
}

/* ---------- 全局兜底：任何未捕获错误都不能让页面崩 ---------- */
function installGlobalGuards() {
  window.addEventListener('error', (e) => {
    log('error', '全局 error 捕获', e.message || String(e.error || ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    log('error', '未处理的 Promise rejection 已被兜底捕获',
      (reason && reason.name ? reason.name + ': ' : '') + ((reason && reason.message) || String(reason)));
    e.preventDefault();
  });
}

/* ---------- 启动 ---------- */
async function restoreLastAndAutoplay() {
  // 默认离线源：无手势、无网络也能演示自动播放被阻止
  let def = SOURCES[0];
  const saved = await dbGet(STORE_META, 'lastSource');
  if (saved && saved.id) {
    if (saved.id === 'custom' && saved.src) {
      def = { id: 'custom', label: saved.label, kind: saved.kind, url: saved.src };
    } else {
      const found = SOURCES.find((x) => x.id === saved.id);
      if (found) def = found;
    }
  }
  $('#sourceSelect').value = def.id === 'custom' ? '' : def.id;
  log('info', '页面加载完成：未发生任何用户交互，立即尝试自动播放（最严格场景）',
    '内置 WAV 为离线生成，无需网络');
  await loadAndTryAutoplay({
    src: def.url, kind: def.kind, label: def.label,
    isBlob: def.id === 'local-audio', persistMeta: null
  });
}

function init() {
  installGlobalGuards();
  populateSources();
  buildPermissionCards();
  bindControls();
  bindSourceForm();
  $('#pipBtn').addEventListener('click', togglePip);
  $('#pipFallbackBtn').addEventListener('click', openMiniFallback);
  $('#miniCloseBtn').addEventListener('click', closeMiniFallback);
  $('#msBtn').addEventListener('click', registerMediaSession);
  $('#logLevelFilter').addEventListener('change', applyLogFilter);
  $('#clearLogsBtn').addEventListener('click', async () => {
    await dbClear(STORE_LOGS);
    memoryLogs.length = 0;
    $('#logList').textContent = '';
    log('info', '日志已清空');
  });

  refreshEnvironment();
  detectFeatures();
  updatePipAvailability();
  setInterval(refreshEnvironment, 500);

  (async () => {
    await restoreLogs();
    log('info', '应用初始化完成',
      `安全上下文=${window.isSecureContext}，Permissions=${features.permissions}，PiP=${features.pip}，MediaSession=${features.mediaSession}`);
    // 页面刚加载：没有任何用户交互，直接尝试自动播放
    restoreLastAndAutoplay();
    // 麦克风/摄像头初始状态查询（无手势也允许 query，不允许也不崩）
    for (const p of PERMISSIONS) queryPermission(p);
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
