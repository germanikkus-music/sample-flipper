// Decoding, chop processing (flips), pitch rendering and WAV encoding.
(function (SF) {
  'use strict';

  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;

  SF.getContext = function () {
    if (!ctx) {
      ctx = new AC({ latencyHint: 'interactive' });
      SF.master = ctx.createGain();
      SF.master.gain.value = 0.9;
      SF.master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };

  // Sample rate from a WAV or AIFF header, 0 if unknown.
  SF.headerRate = function (ab) {
    if (ab.byteLength < 64) return 0;
    const v = new DataView(ab);
    const tag = function (o) { return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3)); };
    if (tag(0) === 'RIFF' && tag(8) === 'WAVE') {
      for (let o = 12; o + 8 <= ab.byteLength;) {
        const size = v.getUint32(o + 4, true);
        if (tag(o) === 'fmt ') return v.getUint32(o + 12, true);
        o += 8 + size + (size & 1);
      }
    }
    if (tag(0) === 'FORM' && (tag(8) === 'AIFF' || tag(8) === 'AIFC')) {
      for (let o = 12; o + 8 <= ab.byteLength;) {
        const size = v.getUint32(o + 4);
        if (tag(o) === 'COMM') {
          // 80-bit extended float at offset 8 of the chunk body.
          const exp = (v.getUint16(o + 16) & 0x7FFF) - 16383;
          const mant = v.getUint32(o + 18);
          return Math.round(mant * Math.pow(2, exp - 31));
        }
        o += 8 + size + (size & 1);
      }
    }
    return 0;
  };

  // Decodes at the file's own rate (WAV/AIFF) or 44.1 kHz, the MPC's native
  // rate, instead of the sound card's rate, so exports don't get resampled.
  SF.decode = function (arrayBuffer) {
    SF.getContext();
    let rate = SF.headerRate(arrayBuffer);
    if (!(rate >= 8000 && rate <= 192000)) rate = 44100;
    let c;
    try {
      c = new OfflineAudioContext(2, 1, rate);
    } catch (e) {
      c = SF.getContext();
    }
    return new Promise(function (resolve, reject) {
      const p = c.decodeAudioData(arrayBuffer, resolve, function (err) {
        reject(err || new Error('decode failed'));
      });
      if (p && p.then) p.then(resolve, reject);
    });
  };

  SF.rateFromSemis = function (semis) {
    return Math.pow(2, semis / 12);
  };

  // Copies src[start, end) and applies reverse, gain and fades. Pitch is
  // applied at playback (playbackRate) or by renderAtRate for export.
  SF.processChop = function (src, start, end, f) {
    const c = SF.getContext();
    const len = Math.max(1, end - start);
    const sr = src.sampleRate;
    const out = c.createBuffer(src.numberOfChannels, len, sr);
    const gain = Math.pow(10, f.gain / 20);
    const fi = Math.min(len, Math.round(f.fadeIn / 1000 * sr));
    const fo = Math.min(len, Math.round(f.fadeOut / 1000 * sr));
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const s = src.getChannelData(ch);
      const d = out.getChannelData(ch);
      if (f.reverse) {
        for (let i = 0; i < len; i++) d[i] = s[end - 1 - i] * gain;
      } else {
        for (let i = 0; i < len; i++) d[i] = s[start + i] * gain;
      }
      // Fades come after reverse so "fade in" is always the start of what you hear.
      for (let i = 0; i < fi; i++) d[i] *= i / fi;
      for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
    }
    return out;
  };

  // Resamples a buffer by a playback rate (pitch + speed, like an MPC "tune").
  SF.renderAtRate = function (buffer, rate) {
    if (Math.abs(rate - 1) < 1e-6) return Promise.resolve(buffer);
    const len = Math.max(1, Math.ceil(buffer.length / rate));
    const oc = new OfflineAudioContext(buffer.numberOfChannels, len, buffer.sampleRate);
    const s = oc.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    s.connect(oc.destination);
    s.start(0);
    return oc.startRendering();
  };

  SF.peak = function (buffer) {
    let p = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const a = d[i] < 0 ? -d[i] : d[i];
        if (a > p) p = a;
      }
    }
    return p;
  };

  // PCM WAV, 16 or 24 bit. Returns Uint8Array.
  SF.encodeWav = function (buffer, bitDepth, scale) {
    const bytes = bitDepth === 24 ? 3 : 2;
    const chs = buffer.numberOfChannels;
    const n = buffer.length;
    const dataLen = n * chs * bytes;
    const out = new Uint8Array(44 + dataLen);
    const v = new DataView(out.buffer);
    const str = function (o, s) { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF');
    v.setUint32(4, 36 + dataLen, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, chs, true);
    v.setUint32(24, buffer.sampleRate, true);
    v.setUint32(28, buffer.sampleRate * chs * bytes, true);
    v.setUint16(32, chs * bytes, true);
    v.setUint16(34, bytes * 8, true);
    str(36, 'data');
    v.setUint32(40, dataLen, true);

    const data = [];
    for (let ch = 0; ch < chs; ch++) data.push(buffer.getChannelData(ch));
    const k = scale || 1;
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < chs; ch++) {
        let x = data[ch][i] * k;
        x = x > 1 ? 1 : x < -1 ? -1 : x;
        if (bytes === 2) {
          v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
          o += 2;
        } else {
          const s = Math.round(x < 0 ? x * 0x800000 : x * 0x7FFFFF);
          out[o] = s & 0xFF;
          out[o + 1] = (s >> 8) & 0xFF;
          out[o + 2] = (s >> 16) & 0xFF;
          o += 3;
        }
      }
    }
    return out;
  };

  SF.download = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  };
})(window.SF = window.SF || {});
