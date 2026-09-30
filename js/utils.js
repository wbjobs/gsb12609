(function (global) {
  'use strict';

  var MP = global.MP || (global.MP = {});

  MP.env = {
    get secure() {
      return typeof global.isSecureContext === 'boolean'
        ? global.isSecureContext
        : global.location.protocol === 'https:' || global.location.hostname === 'localhost' || global.location.hostname === '127.0.0.1';
    },
    get activation() {
      if (typeof global.navigator.userActivation === 'object' && global.navigator.userActivation !== null) {
        return Boolean(global.navigator.userActivation.isActive);
      }
      return false;
    },
    activationSupported: typeof global.navigator !== 'undefined' &&
      typeof global.navigator.userActivation === 'object' && global.navigator.userActivation !== null
  };

  MP.$ = function (selector, root) {
    return (root || document).querySelector(selector);
  };

  MP.$all = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  MP.escapeHtml = function (text) {
    var div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  };

  MP.describeError = function (err) {
    if (!err) return { name: 'UnknownError', message: '未知错误' };
    return {
      name: err.name || 'UnknownError',
      message: err.message || String(err)
    };
  };

  // 通过 Permissions-Policy 判定某能力是否被文档/嵌入方禁止
  MP.policyAllows = function (feature) {
    try {
      if (typeof document.featurePolicy !== 'undefined' &&
          typeof document.featurePolicy.allowsFeature === 'function') {
        return document.featurePolicy.allowsFeature(feature);
      }
    } catch (e) { /* 忽略，按允许处理 */ }
    return true;
  };

  MP.readinessText = function (state) {
    return {
      0: 'HAVE_NOTHING（无数据）',
      1: 'HAVE_METADATA（元数据）',
      2: 'HAVE_CURRENT_DATA（当前帧）',
      3: 'HAVE_FUTURE_DATA（可播放）',
      4: 'HAVE_ENOUGH_DATA（缓冲充足）'
    }[state] || ('状态码 ' + state);
  };

  MP.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var self = this;
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  };

  MP.formatTime = function (seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    var total = Math.floor(seconds);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var mm = h > 0 && m < 10 ? '0' + m : '' + m;
    var ss = s < 10 ? '0' + s : '' + s;
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  };
})(window);
