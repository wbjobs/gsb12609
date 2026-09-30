(function (global) {
  'use strict';

  var MP = global.MP;

  var DEFINITIONS = [
    {
      id: 'camera',
      label: '摄像头 (camera)',
      desc: '通过 Permissions API 查询，申请时调用 getUserMedia({ video: true })。',
      permissionName: 'camera',
      constraints: { video: true }
    },
    {
      id: 'microphone',
      label: '麦克风 (microphone)',
      desc: '通过 Permissions API 查询，申请时调用 getUserMedia({ audio: true })。',
      permissionName: 'microphone',
      constraints: { audio: true }
    },
    {
      id: 'notifications',
      label: '通知 (notifications)',
      desc: '非媒体权限，用于演示同一套状态模型；只能在用户手势内申请。',
      permissionName: 'notifications',
      constraints: null
    }
  ];

  var changeListeners = [];

  function permissionsApiAvailable() {
    return typeof global.navigator !== 'undefined' && !!global.navigator.permissions &&
      typeof global.navigator.permissions.query === 'function';
  }

  function mediaDevicesAvailable() {
    return MP.env.secure && !!global.navigator.mediaDevices &&
      typeof global.navigator.mediaDevices.getUserMedia === 'function';
  }

  var STATE_TEXT = {
    granted: { label: 'granted（已授予）', cls: 'ok' },
    prompt: { label: 'prompt（待询问）', cls: 'warn' },
    default: { label: 'default（待询问）', cls: 'warn' },
    denied: { label: 'denied（已拒绝）', cls: 'err' },
    unsupported: { label: 'unsupported（浏览器不支持查询）', cls: 'err' },
    'insecure-context': { label: '非安全上下文（能力被禁用）', cls: 'err' },
    error: { label: 'error（查询出错）', cls: 'err' },
    unknown: { label: 'unknown（无法判定）', cls: 'warn' }
  };

  function queryOne(def) {
    // 非安全上下文：Permissions API / mediaDevices 整体不可用
    if (!MP.env.secure) {
      return Promise.resolve({
        id: def.id,
        state: 'insecure-context',
        detail: '当前为非安全上下文（非 HTTPS / 非 localhost），Permissions API 与 getUserMedia 被禁用。请在 HTTPS 或 localhost 下重试。'
      });
    }

    // notifications 走 Notification.permission
    if (def.id === 'notifications') {
      if (typeof global.Notification === 'undefined') {
        return Promise.resolve({ id: def.id, state: 'unsupported', detail: '浏览器不支持 Notification API。' });
      }
      return Promise.resolve({
        id: def.id,
        state: global.Notification.permission || 'default',
        detail: 'default 等同于 prompt（尚未询问）。'
      });
    }

    if (!permissionsApiAvailable()) {
      return Promise.resolve({
        id: def.id,
        state: 'unsupported',
        detail: 'navigator.permissions 不可用（如 Safari/Firefox 部分版本），无法预先查询；可直接在用户手势内申请，由申请结果推断状态。'
      });
    }

    return new Promise(function (resolve) {
      var p;
      try {
        p = global.navigator.permissions.query({ name: def.permissionName });
      } catch (e) {
        resolve({ id: def.id, state: 'unsupported', detail: '查询抛出异常：' + e.name + ' — ' + e.message });
        return;
      }
      if (!p || typeof p.then !== 'function') {
        resolve({ id: def.id, state: 'unsupported', detail: 'Permissions.query 未返回 Promise。' });
        return;
      }
      p.then(function (status) {
        resolve({ id: def.id, state: status.state, detail: 'Permissions API 查询成功，可订阅 onchange。', status: status });
      }, function (err) {
        var info = MP.describeError(err);
        if (info.name === 'TypeError') {
          resolve({ id: def.id, state: 'unsupported', detail: '浏览器不支持权限名 "' + def.permissionName + '"。' });
        } else {
          resolve({ id: def.id, state: 'error', detail: info.name + ' — ' + info.message });
        }
      });
    });
  }

  function queryAll() {
    return Promise.all(DEFINITIONS.map(queryOne)).then(function (results) {
      // 给 camera/microphone 挂载 onchange 监听
      results.forEach(function (r) {
        if (r.status && typeof r.status.addEventListener === 'function') {
          r.status.addEventListener('change', function () {
            changeListeners.forEach(function (fn) {
              try { fn(r.id, r.status.state); } catch (e) { /* 忽略 */ }
            });
          });
        }
      });
      return {
        secure: MP.env.secure,
        permissionsApi: permissionsApiAvailable(),
        mediaDevices: mediaDevicesAvailable(),
        results: results
      };
    });
  }

  function stopTracks(stream) {
    if (!stream) return;
    try {
      stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) { /* 忽略 */ }
  }

  function request(def) {
    if (!MP.env.secure) {
      return Promise.resolve({
        id: def.id,
        ok: false,
        state: 'insecure-context',
        message: '非安全上下文下 getUserMedia / Notification.requestPermission 被禁用，请使用 HTTPS 或 localhost。'
      });
    }

    if (def.id === 'notifications') {
      if (typeof global.Notification === 'undefined' || typeof global.Notification.requestPermission !== 'function') {
        return Promise.resolve({ id: def.id, ok: false, state: 'unsupported', message: '浏览器不支持通知权限申请。' });
      }
      return new Promise(function (resolve) {
        try {
          var result = global.Notification.requestPermission(function (permission) {
            resolve({
              id: def.id,
              ok: permission === 'granted',
              state: permission,
              message: permission === 'granted' ? '通知权限已授予。' : permission === 'denied' ? '通知权限被拒绝，可在浏览器站点设置中重置。' : '用户关闭了授权弹窗（仍为 prompt）。'
            });
          });
          if (result && typeof result.then === 'function') {
            result.then(function (permission) {
              resolve({
                id: def.id,
                ok: permission === 'granted',
                state: permission,
                message: permission === 'granted' ? '通知权限已授予。' : permission === 'denied' ? '通知权限被拒绝，可在浏览器站点设置中重置。' : '用户关闭了授权弹窗（仍为 prompt）。'
              });
            }, function (err) {
              var info = MP.describeError(err);
              resolve({ id: def.id, ok: false, state: 'error', message: info.name + ' — ' + info.message });
            });
          }
        } catch (e) {
          var info2 = MP.describeError(e);
          resolve({ id: def.id, ok: false, state: 'error', message: info2.name + ' — ' + info2.message });
        }
      });
    }

    if (!mediaDevicesAvailable()) {
      return Promise.resolve({
        id: def.id,
        ok: false,
        state: 'unsupported',
        message: 'navigator.mediaDevices.getUserMedia 不可用（非安全上下文或浏览器不支持）。'
      });
    }

    return global.navigator.mediaDevices.getUserMedia(def.constraints).then(function (stream) {
      stopTracks(stream); // 演示只需拿到授权，立即释放摄像头/麦克风指示灯
      return { id: def.id, ok: true, state: 'granted', message: '权限已授予，演示流已立即关闭（释放设备）。' };
    }, function (err) {
      var info = MP.describeError(err);
      var state = 'error';
      var message = info.name + ' — ' + info.message;
      if (info.name === 'NotAllowedError' || info.name === 'SecurityError') {
        state = 'denied';
        message = '权限被拒绝（NotAllowedError）。若是此前勾选“始终阻止”，需到浏览器站点设置中手动重置。';
      } else if (info.name === 'NotFoundError' || info.name === 'DevicesNotFoundError') {
        state = 'unavailable';
        message = '未检测到可用的摄像头/麦克风设备（NotFoundError）。';
      } else if (info.name === 'NotReadableError' || info.name === 'TrackStartError') {
        state = 'in-use';
        message = '设备存在但无法读取（可能被其它应用占用，NotReadableError）。';
      } else if (info.name === 'OverconstrainedError') {
        state = 'unavailable';
        message = '没有设备满足约束条件（OverconstrainedError）。';
      }
      return { id: def.id, ok: false, state: state, message: message };
    });
  }

  MP.permissions = {
    definitions: DEFINITIONS,
    queryAll: queryAll,
    request: request,
    stateText: STATE_TEXT,
    onChange: function (fn) {
      changeListeners.push(fn);
      return function () {
        var i = changeListeners.indexOf(fn);
        if (i >= 0) changeListeners.splice(i, 1);
      };
    }
  };
})(window);
