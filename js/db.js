(function (global) {
  'use strict';

  var MP = global.MP;
  var DB_NAME = 'media-play-lab';
  var DB_VERSION = 1;
  var STORE = 'logs';

  var dbInstance = null;

  function supported() {
    return typeof global.indexedDB !== 'undefined';
  }

  function open() {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (!supported()) {
      return Promise.reject(Object.assign(new Error('当前环境不支持 IndexedDB（可能是非安全上下文）'), { name: 'NotSupportedError' }));
    }
    return new Promise(function (resolve, reject) {
      var req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = function () {
        dbInstance = req.result;
        resolve(dbInstance);
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () {
        reject(Object.assign(new Error('IndexedDB 升级被其它标签页阻塞'), { name: 'BlockedError' }));
      };
    });
  }

  function tx(storeName, mode) {
    return open().then(function (db) {
      return db.transaction(storeName, mode).objectStore(storeName);
    });
  }

  MP.db = {
    supported: supported,

    add: function (entry) {
      return tx(STORE, 'readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.add(entry);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },

    getAll: function () {
      return tx(STORE, 'readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.index('ts').getAll();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },

    count: function () {
      return tx(STORE, 'readonly').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.count();
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },

    clear: function () {
      return tx(STORE, 'readwrite').then(function (store) {
        return new Promise(function (resolve, reject) {
          var req = store.clear();
          req.onsuccess = function () { resolve(); };
          req.onerror = function () { reject(req.error); };
        });
      });
    }
  };
})(window);
