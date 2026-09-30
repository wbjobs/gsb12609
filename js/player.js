(function (global) {
  'use strict';

  var MP = global.MP;

  function createPlayer(videoEl) {
    var audioEl = document.createElement('audio');
    audioEl.setAttribute('playsinline', '');
    audioEl.preload = 'metadata';

    var els = { video: videoEl, audio: audioEl };
    var current = null;          // 'video' | 'audio'
    var objectUrl = null;
    var sourceLabel = '未加载';
    var lastBlock = null;
    var stateListeners = [];

    function el() {
      return current ? els[current] : null;
    }

    function otherEl() {
      return current === 'video' ? els.audio : els.video;
    }

    function emit() {
      var snap = snapshot();
      stateListeners.forEach(function (fn) {
        try { fn(snap); } catch (e) { /* 状态监听器不允许影响播放 */ }
      });
    }

    function bindEvents(mediaEl, tag) {
      [
        'play', 'playing', 'pause', 'ended', 'volumechange',
        'mute', 'loadedmetadata', 'durationchange', 'timeupdate',
        'waiting', 'canplay', 'error'
      ].forEach(function (evt) {
        mediaEl.addEventListener(evt, function () {
          if (current !== tag) return;
          if (evt === 'error') {
            var err = mediaEl.error;
            if (err) {
              var codes = {
                1: 'MEDIA_ERR_ABORTED（加载中止）',
                2: 'MEDIA_ERR_NETWORK（网络错误）',
                3: 'MEDIA_ERR_DECODE（解码失败）',
                4: 'MEDIA_ERR_SRC_NOT_SUPPORTED（资源不受支持 / 地址不可用）'
              };
              MP.logger.err('player', '媒体错误：' + (codes[err.code] || err.code) +
                (err.message ? ' — ' + err.message : ''));
            }
          } else {
            MP.logger.info('player', evt + ' 事件触发');
          }
          emit();
        });
      });
    }

    bindEvents(els.video, 'video');
    bindEvents(els.audio, 'audio');

    ['enterpictureinpicture', 'leavepictureinpicture'].forEach(function (evt) {
      els.video.addEventListener(evt, function () {
        MP.logger.info('pip', evt + ' 事件触发');
        emit();
      });
    });

    function revokeCurrent() {
      [els.video, els.audio].forEach(function (m) {
        try { m.pause(); } catch (e) { /* 忽略 */ }
        m.removeAttribute('src');
        try { m.load(); } catch (e2) { /* 忽略 */ }
      });
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) { /* 忽略 */ }
        objectUrl = null;
      }
      MP.pip.exitMini();
      lastBlock = null;
    }

    function load(kind, src, label) {
      revokeCurrent();
      current = kind === 'video' ? 'video' : 'audio';
      var mediaEl = el();
      mediaEl.src = src;
      mediaEl.load();
      sourceLabel = label || src;
      MP.logger.ok('player', '已加载' + (kind === 'video' ? '视频' : '音频') + '：' + sourceLabel);
      emit();

      return new Promise(function (resolve) {
        var settled = false;
        function finish(v) {
          if (settled) return;
          settled = true;
          mediaEl.removeEventListener('loadedmetadata', onMeta);
          mediaEl.removeEventListener('error', onErr);
          clearTimeout(timer);
          emit();
          resolve(v);
        }
        function onMeta() {
          finish({ ok: true, kind: kind, duration: mediaEl.duration });
        }
        function onErr() {
          var info = MP.describeError(mediaEl.error || new Error('加载失败'));
          finish({ ok: false, kind: kind, error: info });
        }
        var timer = setTimeout(function () {
          finish({ ok: false, kind: kind, error: { name: 'TimeoutError', message: '加载超时（仍可尝试播放，可能在缓冲）' } });
        }, 15000);
        mediaEl.addEventListener('loadedmetadata', onMeta);
        mediaEl.addEventListener('error', onErr);
      });
    }

    function loadFile(file) {
      var kind = /^video\//.test(file.type) ? 'video' : (/^audio\//.test(file.type) ? 'audio' : null);
      if (!kind) {
        kind = /\.(mp4|webm|ogv|mov|m4v)$/i.test(file.name) ? 'video' :
               (/\.(mp3|wav|ogg|oga|m4a|aac|flac)$/i.test(file.name) ? 'audio' : null);
      }
      if (!kind) {
        return Promise.resolve({ ok: false, error: { name: 'TypeError', message: '无法识别文件音视频类型：' + file.name } });
      }
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (e) { /* 忽略 */ }
      }
      objectUrl = URL.createObjectURL(file);
      return load(kind, objectUrl, file.name + '（本地文件）');
    }

    function attemptAutoplay() {
      var mediaEl = el();
      if (!mediaEl) {
        return Promise.resolve({ ok: false, reason: 'no-media', message: '尚未加载媒体。' });
      }
      lastBlock = null;

      var playResult;
      try {
        playResult = mediaEl.play();
      } catch (err) {
        var syncInfo = MP.describeError(err);
        lastBlock = { reason: MP.autoplay.classifyPlayError(err), name: syncInfo.name, message: syncInfo.message };
        MP.logger.err('autoplay', 'play() 同步抛出：' + syncInfo.name + ' — ' + syncInfo.message);
        emit();
        return Promise.resolve({ ok: false, reason: lastBlock.reason, errorName: syncInfo.name, errorMessage: syncInfo.message });
      }

      if (!playResult || typeof playResult.then !== 'function') {
        MP.logger.warn('autoplay', 'play() 未返回 Promise（老旧浏览器），按事件判断。');
        return Promise.resolve({ ok: true, reason: 'allowed', legacy: true });
      }

      return playResult.then(function () {
        MP.logger.ok('autoplay', '自动播放成功（' + (mediaEl.muted ? '静音' : '有声') + '）。');
        emit();
        return { ok: true, reason: 'allowed' };
      }, function (err) {
        var info = MP.describeError(err);
        var reason = MP.autoplay.classifyPlayError(err);
        lastBlock = { reason: reason, name: info.name, message: info.message };
        MP.logger.warn('autoplay', '自动播放被阻止：' + reason + '（' + info.name + ' — ' + info.message + '）');
        emit();
        return { ok: false, reason: reason, errorName: info.name, errorMessage: info.message };
      });
    }

    function playAuthorized() {
      var mediaEl = el();
      if (!mediaEl) return Promise.resolve({ ok: false, message: '尚未加载媒体。' });
      try {
        var p = mediaEl.play();
        if (p && typeof p.then === 'function') {
          return p.then(function () {
            lastBlock = null;
            emit();
            return { ok: true };
          }, function (err) {
            var info = MP.describeError(err);
            MP.logger.err('player', '手动播放仍失败：' + info.name + ' — ' + info.message);
            emit();
            return { ok: false, error: info };
          });
        }
        return Promise.resolve({ ok: true });
      } catch (err) {
        return Promise.resolve({ ok: false, error: MP.describeError(err) });
      }
    }

    function playMuted() {
      var mediaEl = el();
      if (!mediaEl) return Promise.resolve({ ok: false, message: '尚未加载媒体。' });
      mediaEl.muted = true;
      emit();
      return attemptAutoplay();
    }

    function pause() {
      if (el()) el().pause();
    }

    function setMuted(value) {
      if (el()) el().muted = Boolean(value);
    }

    function setVolume(value) {
      if (el()) el().volume = value;
    }

    function seekBy(delta) {
      var mediaEl = el();
      if (!mediaEl || !isFinite(mediaEl.duration)) return;
      mediaEl.currentTime = Math.min(Math.max(mediaEl.currentTime + delta, 0), mediaEl.duration);
    }

    function snapshot() {
      var mediaEl = el();
      var data = {
        loaded: Boolean(mediaEl),
        kind: current,
        source: sourceLabel,
        paused: true,
        ended: false,
        muted: false,
        volume: 1,
        currentTime: 0,
        duration: NaN,
        readyState: 0,
        pipActive: MP.pip.active(),
        lastBlock: lastBlock
      };
      if (mediaEl) {
        data.paused = mediaEl.paused;
        data.ended = mediaEl.ended;
        data.muted = mediaEl.muted;
        data.volume = mediaEl.volume;
        data.currentTime = mediaEl.currentTime;
        data.duration = mediaEl.duration;
        data.readyState = mediaEl.readyState;
      }
      return data;
    }

    return {
      load: load,
      loadFile: loadFile,
      attemptAutoplay: attemptAutoplay,
      playAuthorized: playAuthorized,
      playMuted: playMuted,
      pause: pause,
      setMuted: setMuted,
      setVolume: setVolume,
      seekBy: seekBy,
      snapshot: snapshot,
      onChange: function (fn) {
        stateListeners.push(fn);
        return function () {
          var i = stateListeners.indexOf(fn);
          if (i >= 0) stateListeners.splice(i, 1);
        };
      },
      get element() { return el(); },
      get videoElement() { return els.video; },
      get isVideo() { return current === 'video'; }
    };
  }

  MP.createPlayer = createPlayer;
})(window);
