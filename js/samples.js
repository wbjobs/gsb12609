(function (global) {
  'use strict';

  var MP = global.MP;

  // 生成一段离线可用的 WAV 提示音（800Hz，约 0.8 秒）
  function makeBeepDataUri(frequency, durationSec) {
    var sampleRate = 8000;
    var total = Math.floor(sampleRate * durationSec);
    var dataSize = total * 2;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);

    function writeStr(offset, str) {
      for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);      // PCM
    view.setUint16(22, 1, true);      // 单声道
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    for (var n = 0; n < total; n++) {
      var envelope = Math.min(1, n / 200, (total - n) / 600);
      var sample = Math.sin(2 * Math.PI * frequency * (n / sampleRate)) * envelope * 0.35;
      view.setInt16(44 + n * 2, sample * 32767, true);
    }

    var bytes = new Uint8Array(buffer);
    var binary = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return 'data:audio/wav;base64,' + global.btoa(binary);
  }

  MP.samples = {
    audio: {
      kind: 'audio',
      name: '内置提示音（离线 WAV）',
      get src() { return makeBeepDataUri(800, 0.8); }
    },
    video: {
      kind: 'video',
      name: 'Big Buck Bunny 在线片段',
      src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
    }
  };
})(window);
