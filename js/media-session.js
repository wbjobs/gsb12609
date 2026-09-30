(function (global) {
  'use strict';

  var MP = global.MP;

  var ACTIONS = [
    'play', 'pause', 'stop', 'seekbackward', 'seekforward',
    'previoustrack', 'nexttrack', 'seekto'
  ];

  function supported() {
    return typeof global.navigator !== 'undefined' && 'mediaSession' in global.navigator;
  }

  function detectActions() {
    var result = {};
    ACTIONS.forEach(function (action) {
      result[action] = false;
      if (!supported() || typeof global.navigator.mediaSession.setActionHandler !== 'function') return;
      try {
        global.navigator.mediaSession.setActionHandler(action, function () {});
        global.navigator.mediaSession.setActionHandler(action, null);
        result[action] = true;
      } catch (e) {
        result[action] = false;
      }
    });
    return result;
  }

  function setMetadata(meta) {
    if (!supported() || typeof global.MediaMetadata === 'undefined') return false;
    try {
      global.navigator.mediaSession.metadata = new global.MediaMetadata({
        title: meta.title || '未知标题',
        artist: meta.artist || '媒体播放行为实验室',
        album: meta.album || '演示页面',
        artwork: meta.artwork || []
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function setPlaybackState(state) {
    if (!supported()) return false;
    try {
      global.navigator.mediaSession.playbackState = state; // none | paused | playing
      return true;
    } catch (e) {
      return false;
    }
  }

  function setPositionState(position, duration, playbackRate) {
    if (!supported() || typeof global.navigator.mediaSession.setPositionState !== 'function') return false;
    try {
      global.navigator.mediaSession.setPositionState({
        duration: isFinite(duration) && duration > 0 ? duration : 0,
        playbackRate: playbackRate || 1,
        position: Math.min(Math.max(position || 0, 0), duration || 0)
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // handlers: { action: fn }
  function register(handlers) {
    if (!supported()) {
      return { ok: false, reason: 'unsupported', message: '浏览器不支持 Media Session API，已降级为页面内键盘快捷键。' };
    }
    if (typeof global.navigator.mediaSession.setActionHandler !== 'function') {
      return { ok: false, reason: 'unsupported', message: 'setActionHandler 不可用，已降级为页面内键盘快捷键。' };
    }
    var installed = [];
    var failed = [];
    ACTIONS.forEach(function (action) {
      if (typeof handlers[action] !== 'function') return;
      try {
        global.navigator.mediaSession.setActionHandler(action, handlers[action]);
        installed.push(action);
      } catch (e) {
        failed.push(action);
      }
    });
    return {
      ok: installed.length > 0,
      installed: installed,
      failed: failed,
      message: '已注册 ' + installed.length + ' 个媒体动作处理器' +
        (failed.length ? '；不支持：' + failed.join(', ') : '') + '。'
    };
  }

  function clearHandlers() {
    if (!supported() || typeof global.navigator.mediaSession.setActionHandler !== 'function') {
      return { ok: false, reason: 'unsupported', message: 'Media Session 不受支持，无需清除。' };
    }
    ACTIONS.forEach(function (action) {
      try { global.navigator.mediaSession.setActionHandler(action, null); } catch (e) { /* 忽略 */ }
    });
    try { global.navigator.mediaSession.metadata = null; } catch (e) { /* 忽略 */ }
    return { ok: true, message: '已清除全部媒体会话处理器与元数据。' };
  }

  MP.mediaSessionMod = {
    supported: supported,
    detectActions: detectActions,
    ACTIONS: ACTIONS,
    register: register,
    clearHandlers: clearHandlers,
    setMetadata: setMetadata,
    setPlaybackState: setPlaybackState,
    setPositionState: setPositionState
  };
})(window);
