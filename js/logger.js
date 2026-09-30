(function (global) {
  'use strict';

  var MP = global.MP;
  var listeners = [];
  var memoryLog = [];
  var MAX_MEMORY = 300;
  var persistFailed = false;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function timestamp(date) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  function emit(entry) {
    listeners.forEach(function (fn) {
      try { fn(entry); } catch (e) { /* 监听器异常不能影响主流程 */ }
    });
  }

  function log(level, source, message) {
    var now = new Date();
    var entry = {
      level: level,
      source: source,
      message: String(message),
      ts: now.getTime(),
      time: timestamp(now)
    };
    memoryLog.push(entry);
    if (memoryLog.length > MAX_MEMORY) memoryLog.shift();
    emit(entry);

    if (!persistFailed && MP.db.supported()) {
      MP.db.add({ level: entry.level, source: entry.source, message: entry.message, ts: entry.ts })
        .catch(function () {
          persistFailed = true;
          var fallback = {
            level: 'warn', source: 'db', message: 'IndexedDB 写入失败，后续日志仅保留在内存',
            ts: Date.now(), time: timestamp(new Date())
          };
          memoryLog.push(fallback);
          emit(fallback);
        });
    }
  }

  MP.logger = {
    info: function (source, msg) { log('info', source, msg); },
    ok: function (source, msg) { log('ok', source, msg); },
    warn: function (source, msg) { log('warn', source, msg); },
    err: function (source, msg) { log('err', source, msg); },

    memory: function () { return memoryLog.slice(); },

    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    clearMemory: function () {
      memoryLog.length = 0;
      emit(null);
    }
  };
})(window);
