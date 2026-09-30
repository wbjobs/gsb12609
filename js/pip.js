(function (global) {
  'use strict';

  var MP = global.MP;
  var miniEl = null;

  function supported() {
    return typeof document !== 'undefined' &&
      typeof document.pictureInPictureEnabled === 'boolean'
      ? document.pictureInPictureEnabled
      : (typeof document.exitPictureInPicture === 'function' ||
         (typeof HTMLVideoElement !== 'undefined' && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function'));
  }

  function check(video) {
    if (!supported()) {
      return {
        ok: false,
        reason: 'unsupported',
        message: '浏览器不支持 Picture-in-Picture API（或已被策略禁用），将使用页面内迷你悬浮窗降级。'
      };
    }
    if (!MP.policyAllows('picture-in-picture')) {
      return {
        ok: false,
        reason: 'permission-policy',
        degraded: true,
        message: 'Permissions-Policy 禁止 picture-in-picture（iframe 需 allow="picture-in-picture"），将使用页面内迷你悬浮窗降级。'
      };
    }
    if (!video) {
      return { ok: false, reason: 'no-video', message: '当前加载的不是视频，画中画仅支持视频元素；音频可继续正常播放。' };
    }
    if (!video.src && !video.currentSrc) {
      return { ok: false, reason: 'no-source', message: '视频尚未加载，无法进入画中画。' };
    }
    return { ok: true };
  }

  function enter(video) {
    var c = check(video);
    if (!c.ok) return Promise.resolve(Object.assign({ action: 'enter', degraded: c.reason !== 'no-video' }, c));
    if (document.pictureInPictureElement === video) {
      return Promise.resolve({ ok: true, action: 'enter', already: true, message: '已处于画中画模式。' });
    }
    if (video.readyState === 0) {
      return new Promise(function (resolve) {
        video.addEventListener('loadedmetadata', function () {
          resolve(enter(video));
        }, { once: true });
        setTimeout(function () {
          resolve({ ok: false, action: 'enter', reason: 'timeout', degraded: true, message: '等待视频元数据超时，无法进入画中画，已降级。' });
        }, 4000);
      });
    }
    return video.requestPictureInPicture().then(function () {
      return { ok: true, action: 'enter', message: '已进入系统级画中画。' };
    }, function (err) {
      var info = MP.describeError(err);
      var reason = 'error';
      if (info.name === 'NotAllowedError') reason = 'not-allowed';
      if (info.name === 'InvalidStateError') reason = 'invalid-state';
      return {
        ok: false,
        action: 'enter',
        reason: reason,
        errorName: info.name,
        errorMessage: info.message,
        degraded: true,
        message: '进入画中画失败（' + info.name + '），已降级为页面内迷你悬浮窗。'
      };
    });
  }

  function exit() {
    if (!supported() || document.pictureInPictureElement == null) {
      return Promise.resolve({ ok: true, action: 'exit', already: true, message: '当前不在画中画中。' });
    }
    return document.exitPictureInPicture().then(function () {
      return { ok: true, action: 'exit', message: '已退出画中画。' };
    }, function (err) {
      var info = MP.describeError(err);
      return { ok: false, action: 'exit', reason: 'error', errorName: info.name, errorMessage: info.message };
    });
  }

  function active() {
    return Boolean(document.pictureInPictureElement);
  }

  // ---- 降级方案：把同一个视频元素移入页面内迷你悬浮窗（播放与声音不中断、不重复） ----
  var videoOriginalParent = null;
  var videoPlaceholder = null;

  function ensureMini() {
    if (miniEl) return miniEl;
    miniEl = document.createElement('div');
    miniEl.id = 'miniFallback';
    miniEl.innerHTML =
      '<div class="mini-slot"></div>' +
      '<div class="mini-bar"><span>迷你悬浮窗（降级）</span><button type="button" data-mini-close title="关闭">✕</button></div>';
    document.body.appendChild(miniEl);
    miniEl.querySelector('[data-mini-close]').addEventListener('click', function () {
      exitMini();
    });
    return miniEl;
  }

  function enterMini(video) {
    if (!video) return null;
    var box = ensureMini();
    if (!videoOriginalParent) videoOriginalParent = video.parentNode;
    if (!videoPlaceholder) {
      videoPlaceholder = document.createElement('div');
      videoPlaceholder.className = 'mini-placeholder';
    }
    if (videoOriginalParent) videoOriginalParent.insertBefore(videoPlaceholder, video);
    box.querySelector('.mini-slot').appendChild(video);
    box.classList.add('active');
    MP.logger.warn('pip', '已降级为页面内迷你悬浮窗（复用同一视频元素，播放不中断）。');
    return box;
  }

  function exitMini() {
    if (!miniEl || !miniEl.classList.contains('active')) return;
    var slotVideo = miniEl.querySelector('.mini-slot video');
    if (slotVideo && videoOriginalParent) {
      videoOriginalParent.insertBefore(slotVideo, videoPlaceholder);
    }
    if (videoPlaceholder && videoPlaceholder.parentNode) {
      videoPlaceholder.parentNode.removeChild(videoPlaceholder);
    }
    videoPlaceholder = null;
    miniEl.classList.remove('active');
  }

  MP.pip = {
    supported: supported,
    check: check,
    enter: enter,
    exit: exit,
    active: active,
    enterMini: enterMini,
    exitMini: exitMini
  };
})(window);
