(function (global) {
  'use strict';

  var MP = global.MP;

  var REASON_TEXT = {
    allowed: {
      title: '自动播放被允许',
      detail: 'play() 的 Promise 已兑现。当前上下文满足自动播放条件（已交互 / 媒体已静音 / 浏览器对本站有播放授权 / 桌面版被加入白名单等）。'
    },
    'no-user-activation': {
      title: '被阻止：缺少用户交互（最常见）',
      detail: '错误为 NotAllowedError，且当前没有 transient/user activation，Permissions-Policy 允许 autoplay。浏览器的 Autoplay Policy 要求有声自动播放前有用户手势（点击、触摸、按键），或站点已获得媒体参与度（MEI）授权。'
    },
    'muted-only': {
      title: '仅允许静音自动播放',
      detail: '有声播放被拒绝，但同一媒体在 muted=true 时可以播放。建议默认静音播放并展示“取消静音”按钮。'
    },
    'permission-policy': {
      title: '被阻止：Permissions-Policy 禁止',
      detail: 'document.featurePolicy.allowsFeature("autoplay") 为 false。页面通常被嵌入在第三方 iframe 中，而嵌入方没有通过 allow="autoplay" 授权。'
    },
    'insecure-context': {
      title: '被阻止 / 受限：非安全上下文',
      detail: '当前不是安全上下文（非 HTTPS 且非 localhost），且 play() 被拒绝。该环境下媒体能力可能受限：可先点击页面产生手势后重试，若仍被阻止（如 file:// 直开），请升级到 HTTPS。'
    },
    unsupported: {
      title: '浏览器不支持 HTMLMediaElement.play() 的 Promise',
      detail: '老旧浏览器 play() 不返回 Promise，已用播放/暂停事件做兼容判断，结果可能不精确。'
    },
    timeout: {
      title: '探测超时',
      detail: 'play() 在限定时间内既未兑现也未拒绝（可能正在等待加载），无法给出确定结论。'
    },
    aborted: {
      title: '播放被中止（AbortError）',
      detail: '播放过程被 pause()、重新 load() 或新的播放请求打断。这一般不是自动播放策略本身导致。'
    },
    'not-supported-src': {
      title: '媒体资源不受支持或无法解码',
      detail: '错误为 NotSupportedError：媒体编码不被支持，或 src 无法访问（CORS/404）。请更换格式或检查地址。'
    },
    unknown: {
      title: '被阻止：未知原因',
      detail: 'play() 被拒绝但无法匹配已知错误类型，请查看原始错误 name / message。'
    }
  };

  function classifyRejection(err, meta) {
    var name = err && err.name || '';
    var message = (err && err.message || '') + '';

    if (name === 'AbortError') return 'aborted';
    if (name === 'NotSupportedError') return 'not-supported-src';
    if (name !== 'NotAllowedError' && name !== 'SecurityError') return 'unknown';

    if (!MP.env.secure) return 'insecure-context';
    if (!MP.policyAllows('autoplay')) return 'permission-policy';
    if (/media engagement|\bmei\b|playback.*disabled|autoplay/i.test(message)) return 'muted-only';
    if (/gesture|interact|user activation|hasn't.*document|haven't.*document/i.test(message)) return 'no-user-activation';

    // UserActivation API 不支持时无法确认手势状态，按最常见原因归类
    if (!MP.env.activation) return 'no-user-activation';

    // 已确认在用户手势内仍被拒绝：多为平台策略/MEI 限制，静音通常可播
    return 'muted-only';
  }

  function waitLegacy(el, timeoutMs) {
    // 旧浏览器 play() 无 Promise：用 playing 事件 + 错误事件兜底
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        el.removeEventListener('playing', onPlaying);
        el.removeEventListener('error', onError);
        clearTimeout(timer);
        resolve(v);
      }
      function onPlaying() {
        finish({ outcome: 'allowed', reason: 'allowed', legacy: true });
      }
      function onError() {
        var mediaErr = el.error;
        if (mediaErr && mediaErr.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          finish({ outcome: 'blocked', reason: 'not-supported-src', legacy: true });
        } else {
          finish({ outcome: 'blocked', reason: 'no-user-activation', legacy: true });
        }
      }
      var timer = setTimeout(function () {
        finish({ outcome: 'unknown', reason: 'timeout', legacy: true });
      }, timeoutMs);
      el.addEventListener('playing', onPlaying);
      el.addEventListener('error', onError);
    });
  }

  /**
   * 用离屏媒体实际探测自动播放策略
   * options: { muted:boolean, src:string, timeoutMs:number }
   */
  function probe(options) {
    options = options || {};
    var timeoutMs = options.timeoutMs || 4000;
    var src = options.src || MP.samples.audio.src;

    var meta = {
      muted: Boolean(options.muted),
      secure: MP.env.secure,
      activation: MP.env.activation,
      activationSupported: MP.env.activationSupported,
      policyAutoplay: MP.policyAllows('autoplay'),
      src: src
    };

    var el = document.createElement(src.indexOf('data:video') === 0 || /\.mp4|video\//i.test(src) ? 'video' : 'audio');
    el.muted = Boolean(options.muted);
    el.src = src;
    el.setAttribute('playsinline', '');
    el.style.display = 'none';
    document.body.appendChild(el);

    function cleanup() {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch (e) { /* 忽略 */ }
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    var timer = null;
    var timeout = new Promise(function (resolve) {
      timer = setTimeout(function () {
        resolve({ outcome: 'unknown', reason: 'timeout', meta: meta });
      }, timeoutMs);
    });

    var playAttempt;
    try {
      var maybePromise = el.play();
      if (maybePromise && typeof maybePromise.then === 'function') {
        playAttempt = maybePromise.then(function () {
          return { outcome: 'allowed', reason: 'allowed', meta: meta };
        }, function (err) {
          var info = MP.describeError(err);
          return {
            outcome: 'blocked',
            reason: classifyRejection(err, meta),
            errorName: info.name,
            errorMessage: info.message,
            meta: meta
          };
        });
      } else {
        playAttempt = waitLegacy(el, timeoutMs).then(function (r) {
          r.meta = meta;
          return r;
        });
      }
    } catch (err) {
      var syncInfo = MP.describeError(err);
      playAttempt = Promise.resolve({
        outcome: 'blocked',
        reason: classifyRejection(err, meta),
        errorName: syncInfo.name,
        errorMessage: syncInfo.message,
        meta: meta
      });
    }

    return Promise.race([playAttempt, timeout]).then(function (result) {
      clearTimeout(timer);
      cleanup();
      result.text = REASON_TEXT[result.reason] || REASON_TEXT.unknown;
      return result;
    });
  }

  // 先探测有声，再探测静音，判断“是否只允许静音”
  function probeBoth(options) {
    return probe(Object.assign({}, options, { muted: false })).then(function (audible) {
      if (audible.outcome === 'allowed') {
        audible.comparison = '有声可直接播放，通常无需静音降级。';
        return { audible: audible, muted: null };
      }
      return probe(Object.assign({}, options, { muted: true })).then(function (muted) {
        if (muted.outcome === 'allowed' && audible.reason === 'no-user-activation') {
          audible.reason = 'muted-only';
          audible.text = REASON_TEXT['muted-only'];
        }
        audible.comparison = muted.outcome === 'allowed'
          ? '有声被阻止、静音被允许：典型“仅静音自动播放”环境，建议默认静音。'
          : '有声与静音均未放行，需要用户手势触发播放。';
        return { audible: audible, muted: muted };
      });
    });
  }

  // 供播放器复用：判定 play() 拒绝原因（不创建探针媒体）
  function classifyPlayError(err) {
    return classifyRejection(err, {});
  }

  MP.autoplay = {
    probe: probe,
    probeBoth: probeBoth,
    classifyPlayError: classifyPlayError,
    reasonText: REASON_TEXT
  };
})(window);
