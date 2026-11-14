// Transient detection, BPM detection and zero-crossing snapping.
(function (SF) {
  'use strict';

  function mono(buffer) {
    const n = buffer.length;
    const out = new Float32Array(n);
    const chs = buffer.numberOfChannels;
    for (let ch = 0; ch < chs; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < n; i++) out[i] += d[i] / chs;
    }
    return out;
  }
  SF.mono = mono;

  // Frame energy in dB, one value per hop.
  function energyDb(x, hop) {
    const frames = Math.floor(x.length / hop);
    const e = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      const o = f * hop;
      for (let i = 0; i < hop; i++) sum += x[o + i] * x[o + i];
      e[f] = 10 * Math.log10(sum / hop + 1e-10);
    }
    return e;
  }

  // Positive energy rise against the recent past: a simple, robust onset curve.
  function onsetCurve(e) {
    const d = new Float32Array(e.length);
    for (let i = 4; i < e.length; i++) {
      const past = (e[i - 1] + e[i - 2] + e[i - 3] + e[i - 4]) / 4;
      d[i] = Math.max(0, e[i] - past);
    }
    return d;
  }

  // Nudges a position to the nearest zero crossing within `range` samples.
  SF.snapZero = function (buffer, pos, range) {
    const x = buffer.getChannelData(0);
    range = range || Math.round(buffer.sampleRate * 0.002);
    const crosses = function (i) {
      return i >= 1 && i < x.length && ((x[i - 1] <= 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] <= 0));
    };
    for (let k = 0; k <= range; k++) {
      if (crosses(pos - k)) return pos - k;
      if (crosses(pos + k)) return pos + k;
    }
    return pos;
  };

  // sensitivity 0..1 -> sorted sample positions of chop starts. With a BPM,
  // chops are kept at least an 8th (low sensitivity) or 16th note apart.
  SF.detectTransients = function (buffer, sensitivity, maxChops, bpm) {
    const sr = buffer.sampleRate;
    const hop = Math.max(128, Math.round(sr * 0.005)); // ~5 ms
    const x = mono(buffer);
    const e = energyDb(x, hop);
    const d = onsetCurve(e);
    let maxE = -200;
    for (let i = 0; i < e.length; i++) if (e[i] > maxE) maxE = e[i];
    const floor = maxE - 45;

    const thr = 3 + 11 * (1 - sensitivity); // dB rise needed
    const gapSec = bpm ? 60 / bpm * (sensitivity < 0.5 ? 0.5 : 0.25) * 0.85 : 0.18 - 0.12 * sensitivity;
    const minGap = Math.max(1, Math.round(gapSec * sr / hop));
    const cands = [];
    for (let i = 4; i < d.length - 3; i++) {
      if (d[i] < thr || e[i] < floor) continue;
      let isPeak = true;
      for (let k = -3; k <= 3; k++) if (k && d[i + k] > d[i]) { isPeak = false; break; }
      if (isPeak) cands.push({ i: i, s: d[i] });
    }
    // Strongest first, enforce spacing, cap the count.
    cands.sort(function (a, b) { return b.s - a.s; });
    const picked = [];
    for (const c of cands) {
      if (picked.length >= (maxChops || 64)) break;
      if (picked.every(function (p) { return Math.abs(p - c.i) >= minGap; })) picked.push(c.i);
    }
    picked.sort(function (a, b) { return a - b; });

    const preroll = Math.round(sr * 0.004);
    let pos = picked.map(function (f) {
      return SF.snapZero(buffer, Math.max(0, (f - 1) * hop - preroll));
    });
    // Keep the start of the file: replace an onset right at the top, otherwise add 0.
    if (!pos.length || pos[0] > sr * 0.05) pos.unshift(0);
    else pos[0] = 0;
    if (pos.length > (maxChops || 64)) pos = pos.slice(0, maxChops || 64);
    return pos;
  };

  SF.equalSlices = function (buffer, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(i === 0 ? 0 : SF.snapZero(buffer, Math.round(buffer.length * i / n)));
    return out;
  };

  // "OS_ES_90_synth_chords_love_Am.wav" -> 90. Splice and most pack names
  // carry the tempo as a standalone 2-3 digit number or "90bpm".
  SF.bpmFromName = function (name) {
    const base = name.replace(/\.[^.]+$/, '');
    let m = base.match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i);
    if (m) return parseFloat(m[1]);
    const parts = base.split(/[^0-9a-z.]+/i);
    for (const p of parts) {
      if (/^\d{2,3}$/.test(p)) {
        const v = parseInt(p, 10);
        if (v >= 60 && v <= 200) return v;
      }
    }
    return 0;
  };

  // Autocorrelation of the onset curve, then snapped to a whole number of
  // beats over the loop length when that agrees.
  SF.detectBPM = function (buffer) {
    const sr = buffer.sampleRate;
    const hop = 512;
    const fps = sr / hop;
    const x = mono(buffer);
    const maxFrames = Math.floor(Math.min(x.length, sr * 30) / hop);
    const e = energyDb(x.subarray(0, maxFrames * hop), hop);
    const d = onsetCurve(e);
    let mean = 0;
    for (let i = 0; i < d.length; i++) mean += d[i];
    mean /= d.length || 1;
    for (let i = 0; i < d.length; i++) d[i] -= mean;

    const ac = function (lag) {
      let s = 0;
      for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
      return s / (d.length - lag);
    };
    const minLag = Math.floor(fps * 60 / 200);
    const maxLag = Math.ceil(fps * 60 / 60);
    const acv = [];
    for (let lag = 0; lag <= maxLag * 2 + 2; lag++) acv[lag] = lag < d.length ? ac(lag) : 0;

    // Fractional-lag lookup so tempos between frames score fairly.
    const acAt = function (lag) {
      const i = Math.floor(lag), t = lag - i;
      return i + 1 < acv.length ? acv[i] * (1 - t) + acv[i + 1] * t : 0;
    };
    // Harmonic sum: the beat, the 8th note and the bar should all line up,
    // plus a mild preference for common tempos.
    const scoreBpm = function (bpm) {
      const lag = 60 * fps / bpm;
      const prior = Math.exp(-Math.pow(Math.log2(bpm / 100), 2) / 0.5);
      return (acAt(lag) + 0.5 * acAt(lag / 2) + 0.5 * acAt(2 * lag)) * (0.7 + 0.3 * prior);
    };

    let bestLag = 0;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const score = scoreBpm(60 * fps / lag);
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    if (!bestLag || bestScore <= 0) return SF.bpmFromLength(buffer.duration, 0);

    // Most inputs are loops: tempos that fit a whole number of beats in the
    // file win if the onsets support them about as well as the free pick.
    let loopBpm = 0, loopScore = -Infinity;
    // Loops are almost always a power-of-two number of beats (1, 2, 4, 8 bars...).
    for (let beats = 2; beats <= 512; beats *= 2) {
      const bpm = 60 * beats / buffer.duration;
      if (bpm < 70 || bpm > 180) continue;
      const s = scoreBpm(bpm);
      if (s > loopScore) { loopScore = s; loopBpm = bpm; }
    }
    // Sustained material (pads, chords) has no clear pulse: trust the length.
    if (bestScore / acv[0] < 0.12) return SF.bpmFromLength(buffer.duration, 0);
    if (loopBpm && loopScore >= 0.5 * bestScore) return Math.round(loopBpm * 10) / 10;

    // Parabolic interpolation for sub-frame accuracy.
    const a = acv[bestLag - 1], b = acv[bestLag], c = acv[bestLag + 1];
    const shift = (a - c) / (2 * (a - 2 * b + c)) || 0;
    let bpm = 60 * fps / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return SF.bpmFromLength(buffer.duration, bpm);
  };

  // If the file is a clean loop, its length pins the tempo exactly.
  SF.bpmFromLength = function (duration, guess) {
    let best = guess;
    let bestErr = 0.04;
    for (let beats = 1; beats <= 128; beats *= 2) {
      for (const mult of [1, 1.5, 3]) {
        const b = beats * mult;
        const bpm = 60 * b / duration;
        if (bpm < 60 || bpm > 200) continue;
        const err = guess ? Math.abs(bpm / guess - 1) : Math.abs(Math.log2(bpm / 95));
        if (!guess) { if (err < bestErr || best === 0) { bestErr = err; best = bpm; } continue; }
        if (err < bestErr) { bestErr = err; best = bpm; }
      }
    }
    return Math.round((best || 90) * 10) / 10;
  };
})(window.SF = window.SF || {});
