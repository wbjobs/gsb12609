(function (global) {
  'use strict';

  var MP = global.MP;
  var $ = MP.$;

  var videoEl = $('#videoEl');
  var player = MP.createPlayer(videoEl);

  /* ---------- 小工具渲染 ---------- */

  function pill(cls, text) {
    return '<span class="status-pill ' + cls + '">' + MP.escapeHtml(text) + '</span>';
  }

  function setResult(el, cls, html) {
    el.className = 'result-box' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
  }

  function renderEnv() {
    var secure = MP.env.secure;
    var badge = $('#badgeSecure');
    badge.textContent = secure ? '安全上下文 HTTPS/localhost' : '非安全上下文（能力降级中）';
    badge.className = 'badge ' + (secure ? 'ok' : 'err');

    var act = $('#badgeActivation');
    if (MP.env.activation) {
      act.textContent = '已收到用户手势';
      act.className = 'badge ok';
    } else {
      act.textContent = MP.env.activationSupported ? '暂无用户手势' : '用户手势 API 不支持（假定无）';
      act.className = 'badge warn';
    }
  }

  /* ---------- 自动播放探测 ---------- */

  function probeHtml(result, title) {
    var cls = result.outcome === 'allowed' ? 'ok' : (result.reason === 'timeout' ? 'warn' : 'blocked');
    var info = result.text || { title: result.reason, detail: '' };
    var html = '<div class="rb-title">' + (title ? title + '：' : '') + MP.escapeHtml(info.title) + '</div>';
    html += '<div>' + MP.escapeHtml(info.detail) + '</div>';
    var m = result.meta;
    if (m) {
      html += '<div class="meta">环境快照：安全上下文=' + m.secure +
        '，用户激活=' + m.activation + '（UserActivation API ' + (m.activationSupported ? '支持' : '不支持') + '）' +
        '，Permissions-Policy autoplay=' + m.policyAutoplay +
        '，探针静音=' + m.muted + '</div>';
    }
    if (result.errorName) {
      html += '<div class="meta">原始错误：' + MP.escapeHtml(result.errorName) +
        ' — ' + MP.escapeHtml(result.errorMessage || '') + '</div>';
    }
    if (result.legacy) html += '<div class="meta">注：play() 无 Promise，已用播放事件兼容判定。</div>';
    if (result.comparison) html += '<div class="meta">对比结论：' + MP.escapeHtml(result.comparison) + '</div>';
    return '<div class="result-box ' + cls + '">' + html + '</div>';
  }

  function runAudibleProbe() {
    var box = $('#autoplayResult');
    setResult(box, '', '探测中：正在对离屏音频调用 play() …');
    MP.logger.info('autoplay', '开始探测有声自动播放（用户激活=' + MP.env.activation + '）');
    return MP.autoplay.probe({ muted: false }).then(function (result) {
      box.innerHTML = probeHtml(result, '有声');
      MP.logger[result.outcome === 'allowed' ? 'ok' : 'warn']('autoplay', '有声探测结果：' + result.reason);
      renderEnv();
    });
  }

  function runMutedProbe() {
    var box = $('#autoplayResult');
    setResult(box, '', '探测中：静音探针 play() …');
    MP.logger.info('autoplay', '开始探测静音自动播放');
    return MP.autoplay.probe({ muted: true }).then(function (result) {
      box.innerHTML = probeHtml(result, '静音');
      MP.logger[result.outcome === 'allowed' ? 'ok' : 'warn']('autoplay', '静音探测结果：' + result.reason);
      renderEnv();
    });
  }

  function runBothProbes() {
    var box = $('#autoplayResult');
    setResult(box, '', '探测中：先后测试有声与静音…');
    MP.logger.info('autoplay', '开始对比探测（有声 + 静音）');
    return MP.autoplay.probeBoth().then(function (pair) {
      var html = probeHtml(pair.audible, '有声');
      if (pair.muted) html += probeHtml(pair.muted, '静音');
      box.innerHTML = html;
      MP.logger.info('autoplay', '对比探测完成：' + (pair.audible.comparison || ''));
      renderEnv();
    });
  }

  /* ---------- 播放器 ---------- */

  function renderPlayer(snap) {
    var stateText, stateCls;
    if (!snap.loaded) {
      stateText = '未加载'; stateCls = '';
    } else if (snap.pipActive) {
      stateText = '画中画中'; stateCls = 'info';
    } else if (snap.ended) {
      stateText = 'ended（已结束）'; stateCls = 'warn';
    } else if (snap.paused) {
      stateText = 'paused（已暂停）'; stateCls = 'warn';
    } else {
      stateText = 'playing（播放中）'; stateCls = 'ok';
    }
    $('#stPlayState').innerHTML = pill(stateCls, stateText);
    $('#stMuted').innerHTML = pill(snap.muted ? 'err' : 'ok', snap.muted ? 'muted（已静音）' : 'unmuted（有声）');
    $('#stVolume').innerHTML = pill('info', Math.round(snap.volume * 100) + '%');
    $('#stKind').innerHTML = pill('info', snap.loaded ? (snap.kind === 'video' ? '视频 video' : '音频 audio') : '未加载');
    $('#stTime').innerHTML = pill('info', MP.formatTime(snap.currentTime) + ' / ' + MP.formatTime(snap.duration));
    $('#stSource').textContent = snap.source || '-';

    var fb = $('#fallbackBar');
    if (snap.lastBlock && snap.paused) {
      var reasonText = MP.autoplay.reasonText[snap.lastBlock.reason] || MP.autoplay.reasonText.unknown;
      $('#fallbackTitle').textContent = '自动播放被阻止：' + reasonText.title;
      $('#fallbackReason').textContent = (snap.lastBlock.name || '') + ' — 已降级为手动播放。';
      fb.hidden = false;
    } else {
      fb.hidden = true;
    }

    videoEl.classList.toggle('active', snap.loaded && snap.kind === 'video');
    var art = $('#audioArt');
    art.hidden = !(snap.loaded && snap.kind === 'audio');
    art.classList.toggle('playing', snap.loaded && snap.kind === 'audio' && !snap.paused);
  }

  function loadAndTry(kind, src, label, autoplay) {
    return player.load(kind, src, label).then(function (res) {
      if (!res.ok) {
        MP.logger.err('player', '加载失败：' + res.error.name + ' — ' + res.error.message);
      }
      if (autoplay !== false) {
        return player.attemptAutoplay().then(function () { return res; });
      }
      return res;
    });
  }

  /* ---------- 权限 ---------- */

  function renderPermissions(summary) {
    var list = $('#permList');
    var header = '<div class="hint">环境：' +
      '安全上下文=' + summary.secure + '，Permissions API=' + summary.permissionsApi +
      '，getUserMedia=' + summary.mediaDevices + '</div>';
    list.innerHTML = header + summary.results.map(function (r) {
      var def = MP.permissions.definitions.filter(function (d) { return d.id === r.id; })[0];
      var st = MP.permissions.stateText[r.state] || MP.permissions.stateText.unknown;
      return '<div class="perm-card" data-perm="' + r.id + '">' +
        '<div class="perm-head"><span class="perm-name">' + MP.escapeHtml(def.label) + '</span>' +
        '<span class="status-pill ' + st.cls + '">' + MP.escapeHtml(st.label) + '</span></div>' +
        '<div class="perm-desc">' + MP.escapeHtml(def.desc) + '</div>' +
        '<div class="perm-desc">' + MP.escapeHtml(r.detail || '') + '</div>' +
        '<div class="row" style="margin-bottom:0">' +
          '<button class="btn" data-action="perm-request" data-perm="' + r.id + '">申请权限</button>' +
          '<button class="btn btn-ghost" data-action="perm-query" data-perm="' + r.id + '">重新查询</button>' +
        '</div>' +
        '<div class="perm-result"></div>' +
      '</div>';
    }).join('');
  }

  function refreshPermissions() {
    return MP.permissions.queryAll().then(function (summary) {
      renderPermissions(summary);
      MP.logger.info('perm', '权限状态已刷新');
    });
  }

  function requestPermission(id) {
    var def = MP.permissions.definitions.filter(function (d) { return d.id === id; })[0];
    var card = document.querySelector('.perm-card[data-perm="' + id + '"] .perm-result');
    if (card) card.innerHTML = '<span class="muted">申请中（需要用户手势，本点击即手势）…</span>';
    MP.logger.info('perm', '申请权限：' + id + '（用户激活=' + MP.env.activation + '）');
    return MP.permissions.request(def).then(function (res) {
      var cls = res.ok ? 'ok' : (res.state === 'insecure-context' || res.state === 'unsupported' ? 'warn' : 'err');
      var label = res.ok ? '成功' : (res.state === 'denied' ? '被拒绝' : res.state);
      if (card) card.innerHTML = '<div class="perm-error" style="color:var(--' +
        (res.ok ? 'ok' : (cls === 'warn' ? 'warn' : 'err')) + ')">' +
        MP.escapeHtml(label) + '：' + MP.escapeHtml(res.message) + '</div>';
      MP.logger[res.ok ? 'ok' : 'warn']('perm', id + ' 申请结果：' + label + ' — ' + res.message);
      refreshPermissions();
    });
  }

  /* ---------- 画中画 ---------- */

  function renderPip(result, initial) {
    var box = $('#pipResult');
    if (initial) {
      setResult(box, '', '支持情况：系统画中画=' + (MP.pip.supported() ? '支持' : '不支持') +
        '，Permissions-Policy=' + (MP.policyAllows('picture-in-picture') ? '允许' : '禁止') +
        '，当前视频已加载=' + (player.isVideo ? '是' : '否'));
      return;
    }
    var cls = result.ok ? 'ok' : (result.degraded ? 'warn' : 'err');
    var html = '<div class="rb-title">' + MP.escapeHtml(result.message) + '</div>';
    if (result.errorName) {
      html += '<div class="meta">原始错误：' + MP.escapeHtml(result.errorName) +
        ' — ' + MP.escapeHtml(result.errorMessage || '') + '</div>';
    }
    if (result.reason === 'no-video') {
      html += '<div class="meta">音频没有画面可悬浮，但播放、暂停、Media Session 均正常可用。</div>';
    }
    setResult(box, cls, html);
  }

  function enterPip() {
    var check = MP.pip.check(player.videoElement);
    if (!check.ok && check.reason === 'no-video') {
      renderPip(check);
      MP.logger.warn('pip', check.message);
      return;
    }
    MP.pip.enter(player.videoElement).then(function (result) {
      renderPip(result);
      MP.logger[result.ok ? 'ok' : 'warn']('pip', result.message);
      if (!result.ok && result.degraded && player.isVideo) {
        MP.pip.enterMini(player.videoElement);
      }
    });
  }

  function exitPip() {
    MP.pip.exitMini();
    MP.pip.exit().then(function (result) {
      renderPip(result);
      MP.logger.info('pip', result.message);
    });
  }

  /* ---------- Media Session ---------- */

  var sessionRegistered = false;

  function renderMsChips(actions) {
    var box = $('#msActions');
    box.innerHTML = MP.mediaSessionMod.ACTIONS.map(function (a) {
      return '<span class="chip ' + (actions[a] ? 'supported' : '') + '">' +
        a + (actions[a] ? ' ✓' : ' ✗') + '</span>';
    }).join('');
  }

  function initMediaSession() {
    var box = $('#msResult');
    if (!MP.mediaSessionMod.supported()) {
      setResult(box, 'warn',
        '<div class="rb-title">Media Session API 不支持</div>' +
        '<div>已自动降级：页面内键盘快捷键可用 —— 空格 播放/暂停，←/→ 快退/快进 5 秒，↑/↓ 音量，M 静音。</div>');
      MP.logger.warn('media-session', '不支持 Media Session，降级为键盘快捷键。');
      return;
    }
    MP.mediaSessionMod.setMetadata({
      title: player.snapshot().loaded ? '正在播放：' + player.snapshot().source : '媒体播放行为实验室',
      artist: 'Autoplay Lab'
    });
    var handlers = {
      play: function () { player.playAuthorized(); },
      pause: function () { player.pause(); },
      stop: function () { player.pause(); },
      seekbackward: function () { player.seekBy(-5); },
      seekforward: function () { player.seekBy(5); },
      previoustrack: function () { if (player.element) player.element.currentTime = 0; },
      nexttrack: function () { MP.logger.info('media-session', 'nexttrack：无下一首（演示）'); },
      seekto: function (d) { if (player.element && d && isFinite(d.seekTime)) player.element.currentTime = d.seekTime; }
    };
    var result = MP.mediaSessionMod.register(handlers);
    sessionRegistered = result.ok;
    setResult(box, result.ok ? 'ok' : 'err',
      '<div class="rb-title">' + MP.escapeHtml(result.message) + '</div>' +
      '<div class="meta">同时提供键盘快捷键降级/补充：空格、←/→、↑/↓、M。</div>');
    MP.logger[result.ok ? 'ok' : 'warn']('media-session', result.message);
    renderMsChips(MP.mediaSessionMod.detectActions());
  }

  function clearMediaSession() {
    var result = MP.mediaSessionMod.clearHandlers();
    sessionRegistered = false;
    setResult($('#msResult'), result.ok ? 'ok' : 'warn',
      '<div class="rb-title">' + MP.escapeHtml(result.message) + '</div>');
    MP.logger.info('media-session', result.message);
  }

  /* ---------- 日志 ---------- */

  function renderLogsFromMemory() {
    var list = $('#logList');
    var entries = MP.logger.memory().slice().reverse();
    if (entries.length === 0) {
      list.innerHTML = '<li class="log-empty">暂无日志。加载、播放、权限等操作会记录在这里。</li>';
      return;
    }
    list.innerHTML = entries.map(function (e) {
      return '<li class="log-item"><span class="log-time">' + e.time + '</span>' +
        '<span class="log-tag ' + e.level + '">' + MP.escapeHtml(e.source) + '</span>' +
        '<span class="log-msg">' + MP.escapeHtml(e.message) + '</span></li>';
    }).join('');
  }

  function refreshDbState() {
    var state = $('#dbState');
    if (!MP.db.supported()) {
      state.textContent = 'IndexedDB 不可用（非安全上下文），日志仅存内存';
      return;
    }
    MP.db.count().then(function (n) {
      state.textContent = 'IndexedDB 已持久化 ' + n + ' 条日志';
    }, function () {
      state.textContent = 'IndexedDB 打开失败，日志仅存内存';
    });
  }

  function refreshLogs() {
    renderLogsFromMemory();
    refreshDbState();
  }

  function clearLogs() {
    var doneMemory = function () { renderLogsFromMemory(); };
    MP.logger.clearMemory();
    doneMemory();
    if (MP.db.supported()) {
      MP.db.clear().then(refreshDbState, refreshDbState);
    }
  }

  /* ---------- 动作分发 ---------- */

  var actions = {
    'probe-audible': runAudibleProbe,
    'probe-muted': runMutedProbe,
    'probe-both': runBothProbes,
    'load-url': function () {
      var url = $('#urlInput').value.trim();
      if (!url) { MP.logger.warn('player', '未输入 URL'); return; }
      var kind = /\.(mp3|wav|ogg|oga|m4a|aac|flac)(\?|#|$)/i.test(url) ? 'audio' : 'video';
      loadAndTry(kind, url, url);
    },
    'load-sample-audio': function () {
      loadAndTry('audio', MP.samples.audio.src, MP.samples.audio.name);
    },
    'load-sample-video': function () {
      loadAndTry('video', MP.samples.video.src, MP.samples.video.name);
    },
    'play': function () { player.playAuthorized(); },
    'pause': function () { player.pause(); },
    'manual-play': function () { player.playAuthorized(); },
    'muted-play': function () {
      player.playMuted().then(function (res) {
        if (!res.ok) MP.logger.warn('player', '静音播放仍失败：' + res.reason);
      });
    },
    'perm-query-all': refreshPermissions,
    'perm-query': function (btn) {
      var id = btn.getAttribute('data-perm');
      var def = MP.permissions.definitions.filter(function (d) { return d.id === id; })[0];
      // 复用 queryAll 重渲染，单个查询仅写日志
      return MP.permissions.queryAll().then(function (summary) {
        renderPermissions(summary);
        var r = summary.results.filter(function (x) { return x.id === id; })[0];
        MP.logger.info('perm', def.label + ' 当前状态：' + r.state);
      });
    },
    'perm-request': function (btn) {
      return requestPermission(btn.getAttribute('data-perm'));
    },
    'pip-enter': enterPip,
    'pip-exit': exitPip,
    'ms-init': initMediaSession,
    'ms-clear': clearMediaSession,
    'logs-refresh': refreshLogs,
    'logs-clear': clearLogs
  };

  document.addEventListener('click', function (evt) {
    var btn = evt.target.closest('[data-action]');
    if (!btn) return;
    renderEnv();
    var name = btn.getAttribute('data-action');
    var fn = actions[name];
    if (!fn) {
      MP.logger.warn('app', '未知动作：' + name);
      return;
    }
    try {
      var ret = fn(btn, evt);
      if (ret && typeof ret.catch === 'function') {
        ret.catch(function (err) {
          MP.logger.err('app', '动作 ' + name + ' 异常：' + (err && err.message || err));
        });
      }
    } catch (err) {
      MP.logger.err('app', '动作 ' + name + ' 同步异常：' + (err && err.message || err));
    }
  });

  /* ---------- 控件绑定 ---------- */

  $('#fileInput').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    Promise.resolve(player.loadFile(file)).then(function (res) {
      if (!res.ok) {
        MP.logger.err('player', '文件无法加载：' + res.error.name + ' — ' + res.error.message);
        return;
      }
      player.attemptAutoplay();
    });
    this.value = '';
  });

  $('#muteToggle').addEventListener('change', function () {
    player.setMuted(this.checked);
  });

  $('#volumeRange').addEventListener('input', function () {
    player.setVolume(parseFloat(this.value));
  });

  // Media Session 播放状态/位置同步
  player.onChange(function (snap) {
    renderPlayer(snap);
    var mt = $('#muteToggle');
    if (mt.checked !== snap.muted) mt.checked = snap.muted;
    var vr = $('#volumeRange');
    if (Math.abs(parseFloat(vr.value) - snap.volume) > 0.001) vr.value = snap.volume;

    if (MP.mediaSessionMod.supported() && sessionRegistered && snap.loaded) {
      MP.mediaSessionMod.setPlaybackState(snap.paused ? 'paused' : 'playing');
      MP.mediaSessionMod.setPositionState(snap.currentTime, snap.duration, 1);
    }
  });

  // 键盘快捷键（Media Session 不支持时的降级；支持时作为补充）
  document.addEventListener('keydown', function (evt) {
    var tag = (evt.target && evt.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var snap = player.snapshot();
    if (!snap.loaded && evt.code !== 'Space') return;

    switch (evt.code) {
      case 'Space':
        if (!snap.loaded) return;
        evt.preventDefault();
        if (snap.paused) player.playAuthorized(); else player.pause();
        break;
      case 'ArrowLeft':
        player.seekBy(-5);
        break;
      case 'ArrowRight':
        player.seekBy(5);
        break;
      case 'ArrowUp':
        evt.preventDefault();
        $('#volumeRange').value = Math.min(1, snap.volume + 0.05);
        player.setVolume(Math.min(1, snap.volume + 0.05));
        break;
      case 'ArrowDown':
        evt.preventDefault();
        $('#volumeRange').value = Math.max(0, snap.volume - 0.05);
        player.setVolume(Math.max(0, snap.volume - 0.05));
        break;
      case 'KeyM':
        $('#muteToggle').checked = !snap.muted;
        player.setMuted(!snap.muted);
        break;
    }
  });

  // 任意交互后更新手势徽标
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (evtName) {
    global.addEventListener(evtName, function () { renderEnv(); }, { passive: true, once: false });
  });

  /* ---------- 启动 ---------- */

  function boot() {
    renderEnv();
    renderPlayer(player.snapshot());
    renderPip(null, true);
    if (MP.mediaSessionMod.supported()) {
      renderMsChips(MP.mediaSessionMod.detectActions());
    } else {
      renderMsChips({});
    }

    refreshLogs();
    MP.logger.subscribe(renderLogsFromMemory);
    MP.permissions.onChange(function (id, state) {
      MP.logger.info('perm', '系统侧权限状态变更：' + id + ' -> ' + state);
      refreshPermissions();
    });

    MP.logger.info('app', '页面就绪。安全上下文=' + MP.env.secure +
      '，Permissions API=' + (!!navigator.permissions) +
      '，PiP=' + MP.pip.supported() +
      '，MediaSession=' + MP.mediaSessionMod.supported() +
      '，IndexedDB=' + MP.db.supported());

    // 启动即做一次静音探针，展示“无手势时”的真实自动播放判定（静音、无扰）
    setTimeout(function () {
      MP.autoplay.probe({ muted: true }).then(function (result) {
        $('#autoplayResult').innerHTML = probeHtml(result, '启动时静音');
        MP.logger[result.outcome === 'allowed' ? 'ok' : 'warn'](
          'autoplay', '启动静音探针：' + result.reason);
      });
    }, 600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
