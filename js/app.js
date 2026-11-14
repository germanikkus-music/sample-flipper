// UI wiring: loading, chopping, pads, flips, sequencer and exports.
(function (SF) {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const STEPS = 16; // per bar
  const MAX_CHOPS = 64;
  // MPC layout: pad 1 bottom-left, pad 16 top-right. Keys mirror that shape.
  const PAD_KEYS = ['z', 'x', 'c', 'v', 'a', 's', 'd', 'f', 'q', 'w', 'e', 'r', '1', '2', '3', '4'];
  const DEFAULT_FLIP = { reverse: false, pitch: 0, gain: 0, fadeIn: 0, fadeOut: 5, choke: true };

  const S = {
    buffer: null,
    name: 'sample',
    markers: [],
    flips: [],      // per chop index
    cache: [],      // processed AudioBuffers per chop index
    pattern: [],    // pattern[chop] = Array(16 * bars) of booleans
    bars: 4,        // pattern length (4 bars by default)
    selected: -1,
    bank: 0,
    bpm: 90,
    swing: 0,
    voices: [],
  };

  // ---------- helpers ----------

  function status(msg, kind) {
    const el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function padName(i) {
    return 'ABCD'[Math.floor(i / 16)] + String(i % 16 + 1).padStart(2, '0');
  }

  function chopColor(i) {
    const t = (i % 16) / 15;
    return 'hsl(' + Math.round(187 + 88 * t) + ' 95% ' + (62 - 6 * t) + '%)';
  }

  function chopColorInt(i) {
    const t = (i % 16) / 15;
    const a = [34, 229, 255], b = [163, 91, 255];
    const c = a.map(function (v, k) { return Math.round(v + (b[k] - v) * t); });
    return (c[0] << 16) | (c[1] << 8) | c[2];
  }

  function chopCount() { return S.markers.length; }

  function totalSteps() { return STEPS * S.bars; }

  function chopRange(i) {
    return [S.markers[i], i + 1 < S.markers.length ? S.markers[i + 1] : S.buffer.length];
  }

  function safeName(s) {
    return (s.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'sample').slice(0, 32);
  }

  function fmtTime(sec) {
    return sec < 10 ? sec.toFixed(3) + 's' : sec.toFixed(2) + 's';
  }

  function chopBuffer(i) {
    if (!S.cache[i]) {
      const r = chopRange(i);
      S.cache[i] = SF.processChop(S.buffer, r[0], r[1], S.flips[i]);
    }
    return S.cache[i];
  }

  // ---------- playback ----------

  // Shared by live playback and offline rendering so both sound the same.
  function startVoice(ctx, dest, i, when, voices) {
    const f = S.flips[i];
    const buf = chopBuffer(i);
    const rate = SF.rateFromSemis(f.pitch);
    if (f.choke) {
      for (const v of voices) {
        if (!v.choke || v.end <= when || v.start > when) continue;
        v.gain.gain.setValueAtTime(1, when);
        v.gain.gain.linearRampToValueAtTime(0, when + 0.008);
        try { v.src.stop(when + 0.01); } catch (e) { /* already stopped */ }
        v.end = when + 0.01;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(dest);
    src.start(when);
    const v = { src: src, gain: gain, choke: f.choke, start: when, end: when + buf.duration / rate };
    voices.push(v);
    // Drop finished voices so the list stays short.
    for (let k = voices.length - 1; k >= 0; k--) if (voices[k].end < when - 1) voices.splice(k, 1);
    return v;
  }

  function playChop(i, when) {
    if (!S.buffer || i < 0 || i >= chopCount()) return;
    const ctx = SF.getContext();
    stopSample();
    startVoice(ctx, SF.master, i, when || ctx.currentTime, S.voices);
    flashPad(i, when ? (when - ctx.currentTime) * 1000 : 0);
  }

  function flashPad(i, delayMs) {
    if (Math.floor(i / 16) !== S.bank) return;
    const el = document.querySelector('.pad[data-chop="' + i + '"]');
    if (!el) return;
    setTimeout(function () {
      el.classList.add('hit');
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.classList.remove('hit'); }, 110);
    }, Math.max(0, delayMs || 0));
  }

  // Whole-sample playback with a playhead (used for tap-chopping).
  let samplePlay = null;
  function playSample() {
    if (samplePlay) { stopSample(); return; }
    const ctx = SF.getContext();
    const src = ctx.createBufferSource();
    src.buffer = S.buffer;
    src.connect(SF.master);
    const offset = 0;
    src.start(ctx.currentTime, offset);
    samplePlay = { src: src, t0: ctx.currentTime, offset: offset };
    src.onended = function () { if (samplePlay && samplePlay.src === src) stopSample(); };
    $('playSample').textContent = '■ Stop';
    $('playSample').classList.add('on');
    const tick = function () {
      if (!samplePlay) return;
      wf.playhead = samplePos();
      wf.draw();
      requestAnimationFrame(tick);
    };
    tick();
  }
  function samplePos() {
    if (!samplePlay) return -1;
    const ctx = SF.getContext();
    return Math.round((samplePlay.offset + ctx.currentTime - samplePlay.t0) * S.buffer.sampleRate);
  }
  function stopSample() {
    if (!samplePlay) return;
    const s = samplePlay;
    samplePlay = null;
    try { s.src.stop(); } catch (e) { /* already stopped */ }
    $('playSample').textContent = '▶ Sample';
    $('playSample').classList.remove('on');
    wf.playhead = -1;
    wf.draw();
  }

  // ---------- markers / chops ----------

  function setMarkers(list, keepFlips) {
    const sorted = Array.from(new Set(list.map(function (m) { return Math.max(0, Math.round(m)); })))
      .filter(function (m) { return m < S.buffer.length - 32; })
      .sort(function (a, b) { return a - b; })
      .slice(0, MAX_CHOPS);
    S.markers = sorted;
    wf.markers = S.markers;
    syncChops(keepFlips);
  }

  // Keeps per-chop arrays the same length as the marker list.
  function syncChops(keepFlips) {
    const n = chopCount();
    if (!keepFlips) S.flips = [];
    S.flips.length = Math.min(S.flips.length, n);
    for (let i = 0; i < n; i++) if (!S.flips[i]) S.flips[i] = Object.assign({}, DEFAULT_FLIP);
    S.pattern.length = Math.min(S.pattern.length, n);
    for (let i = 0; i < n; i++) if (!S.pattern[i]) S.pattern[i] = new Array(totalSteps()).fill(false);
    S.cache = [];
    if (S.selected >= n) S.selected = n - 1;
    if (S.bank * 16 >= Math.max(16, n)) S.bank = 0;
    wf.selectedMarker = -1;
    wf.selectedChop = S.selected;
    $('delMarker').disabled = true;
    renderAll();
  }

  function addMarker(pos) {
    const p = SF.snapZero(S.buffer, Math.max(0, Math.min(S.buffer.length - 1, pos)));
    if (S.markers.some(function (m) { return Math.abs(m - p) < S.buffer.sampleRate * 0.01; })) return;
    if (chopCount() >= MAX_CHOPS) { status('Max ' + MAX_CHOPS + ' chops.', 'error'); return; }
    // Insert keeping flips and pattern rows attached to the chops they belong to.
    let idx = S.markers.findIndex(function (m) { return m > p; });
    if (idx < 0) idx = S.markers.length;
    S.markers.splice(idx, 0, p);
    const base = idx > 0 ? S.flips[idx - 1] : DEFAULT_FLIP;
    S.flips.splice(idx, 0, Object.assign({}, base));
    S.pattern.splice(idx, 0, new Array(totalSteps()).fill(false));
    S.selected = idx;
    syncChops(true);
  }

  function deleteMarker(i) {
    if (i < 0 || i >= chopCount()) return;
    S.markers.splice(i, 1);
    S.flips.splice(i, 1);
    S.pattern.splice(i, 1);
    if (S.selected >= i) S.selected = Math.max(0, S.selected - 1);
    if (!chopCount()) S.selected = -1;
    syncChops(true);
  }

  function autoChop() {
    if (!S.buffer) return;
    let list;
    if ($('chopMode').value === 'equal') {
      list = SF.equalSlices(S.buffer, parseInt($('slices').value, 10));
    } else {
      list = SF.detectTransients(S.buffer, $('sensitivity').value / 100, MAX_CHOPS, S.bpm);
    }
    S.selected = 0;
    S.bank = 0;
    S.pattern = [];
    setMarkers(list, false);
    patternOriginal();
    status(chopCount() + ' chops.', 'ok');
  }

  function selectChop(i, play) {
    if (i < 0 || i >= chopCount()) return;
    S.selected = i;
    wf.selectedChop = i;
    if (Math.floor(i / 16) !== S.bank) { S.bank = Math.floor(i / 16); renderPads(); renderSeq(); renderBanks(); }
    updatePadSelection();
    renderEdit();
    wf.draw();
    if (play) playChop(i);
  }

  // ---------- rendering ----------

  function renderAll() {
    renderBanks();
    renderPads();
    renderEdit();
    renderSeq();
    renderInfo();
    wf.draw();
    const has = !!S.buffer;
    const hasChops = chopCount() > 0;
    ['playSample', 'tapMark', 'markMode', 'chopMode', 'sensitivity', 'slices', 'chopBtn', 'clearMarkers',
      'zoomIn', 'zoomOut', 'zoomFit', 'bpmDetect'].forEach(function (id) { $(id).disabled = !has; });
    ['seqPlay', 'patOriginal', 'patFlip', 'patClear', 'exportChops', 'exportPattern'].forEach(function (id) {
      $(id).disabled = !hasChops;
    });
  }

  function renderInfo() {
    if (!S.buffer) { $('info').textContent = ''; return; }
    const b = S.buffer;
    let txt = fmtTime(b.duration) + ' · ' + b.sampleRate + ' Hz · ' + (b.numberOfChannels > 1 ? 'stereo' : 'mono') +
      ' · ' + chopCount() + ' chop' + (chopCount() === 1 ? '' : 's');
    if (chopCount() > 16) txt += ' (banks A–' + 'ABCD'[Math.ceil(chopCount() / 16) - 1] + ')';
    $('info').textContent = txt;
  }

  function renderBanks() {
    const el = $('banks');
    el.innerHTML = '';
    const n = Math.ceil(chopCount() / 16);
    if (n < 2) return;
    for (let b = 0; b < n; b++) {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b === S.bank ? ' on' : '');
      btn.textContent = 'Bank ' + 'ABCD'[b];
      btn.addEventListener('click', function () { S.bank = b; renderBanks(); renderPads(); renderSeq(); });
      el.appendChild(btn);
    }
  }

  function renderPads() {
    const el = $('pads');
    el.innerHTML = '';
    // Grid rows top to bottom: pads 13-16, 9-12, 5-8, 1-4.
    for (let row = 3; row >= 0; row--) {
      for (let col = 0; col < 4; col++) {
        const p = row * 4 + col;
        const i = S.bank * 16 + p;
        const btn = document.createElement('button');
        btn.className = 'pad';
        btn.dataset.chop = i;
        btn.style.setProperty('--c', chopColor(i));
        const has = i < chopCount();
        btn.classList.add(has ? 'has' : 'empty');
        let tags = '';
        let len = '';
        if (has) {
          const f = S.flips[i];
          const t = [];
          if (f.reverse) t.push('REV');
          if (f.pitch) t.push((f.pitch > 0 ? '+' : '') + f.pitch + 'st');
          if (f.gain) t.push((f.gain > 0 ? '+' : '') + f.gain + 'dB');
          tags = t.join(' ');
          const r = chopRange(i);
          len = fmtTime((r[1] - r[0]) / S.buffer.sampleRate / SF.rateFromSemis(f.pitch));
        }
        btn.innerHTML = '<span class="pnum">' + padName(i) + '</span><span class="pkey">' +
          PAD_KEYS[p].toUpperCase() + '</span><span class="ptags">' + tags + '</span><span class="plen">' + len + '</span>';
        if (has) {
          btn.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            selectChop(i, true);
          });
        }
        el.appendChild(btn);
      }
    }
    updatePadSelection();
  }

  function updatePadSelection() {
    document.querySelectorAll('.pad').forEach(function (el) {
      el.classList.toggle('selected', +el.dataset.chop === S.selected);
    });
  }

  function renderEdit() {
    const i = S.selected;
    const ok = S.buffer && i >= 0 && i < chopCount();
    $('edit').classList.toggle('disabled', !ok);
    $('auditionBtn').disabled = !ok;
    if (!ok) { $('editTitle').textContent = 'no chop'; return; }
    const f = S.flips[i];
    const r = chopRange(i);
    const sr = S.buffer.sampleRate;
    $('editTitle').textContent = padName(i) + ' · ' + fmtTime(r[0] / sr) + ' → ' + fmtTime(r[1] / sr);
    $('fReverse').checked = f.reverse;
    $('fChoke').checked = f.choke;
    $('fPitch').value = f.pitch;
    $('fGain').value = f.gain;
    $('fFadeIn').value = f.fadeIn;
    $('fFadeOut').value = f.fadeOut;
    renderEditOutputs(f);
  }

  function renderEditOutputs(f) {
    $('oPitch').textContent = (f.pitch > 0 ? '+' : '') + f.pitch + ' st';
    $('oGain').textContent = (f.gain > 0 ? '+' : '') + f.gain + ' dB';
    $('oFadeIn').textContent = f.fadeIn + ' ms';
    $('oFadeOut').textContent = f.fadeOut + ' ms';
  }

  function renderSeq() {
    const el = $('seq');
    el.innerHTML = '';
    const n = chopCount();
    if (!n) {
      el.innerHTML = '<div class="seq-empty">Load and chop a sample to build a pattern.</div>';
      return;
    }
    // Every bar in one chart: column template set from the pattern length.
    const total = totalSteps();
    const cols = '44px repeat(' + total + ', minmax(0, 1fr))';
    el.dataset.bars = S.bars; // fewer bars = bigger cells (see style.css)
    el.style.minWidth = (44 + total * 11) + 'px';
    const head = document.createElement('div');
    head.className = 'seq-steps';
    head.style.gridTemplateColumns = cols;
    head.innerHTML = '<span></span>' + Array.from({ length: total }, function (_, s) {
      const label = s % STEPS === 0 ? 'Bar ' + (s / STEPS + 1) : (s % 4 === 0 ? String((s % STEPS) / 4 + 1) : '');
      return '<span data-step="' + s + '"' + (s % STEPS === 0 ? ' class="bar"' : '') + '>' + label + '</span>';
    }).join('');
    el.appendChild(head);
    const first = S.bank * 16;
    const last = Math.min(n, first + 16);
    for (let i = first; i < last; i++) {
      const row = document.createElement('div');
      row.className = 'seq-row';
      row.style.gridTemplateColumns = cols;
      row.style.setProperty('--c', chopColor(i));
      const label = document.createElement('div');
      label.className = 'seq-label';
      label.textContent = padName(i);
      label.addEventListener('click', function () { selectChop(i, true); });
      row.appendChild(label);
      for (let s = 0; s < total; s++) {
        const k = s % STEPS;
        const cell = document.createElement('button');
        cell.className = 'cell' + (k % 4 === 0 ? ' beat' : '') + (k === 0 && s ? ' bar' : '') + (S.pattern[i][s] ? ' on' : '');
        cell.dataset.step = s;
        cell.setAttribute('aria-label', padName(i) + ' bar ' + (Math.floor(s / STEPS) + 1) + ' step ' + (k + 1));
        cell.addEventListener('click', function () {
          S.pattern[i][s] = !S.pattern[i][s];
          cell.classList.toggle('on', S.pattern[i][s]);
          if (S.pattern[i][s] && !seq.playing) playChop(i);
        });
        row.appendChild(cell);
      }
      el.appendChild(row);
    }
  }

  // Changing the length keeps what's there; a longer pattern repeats it.
  function setBars(n) {
    const old = totalSteps();
    S.bars = n;
    const total = totalSteps();
    S.pattern = S.pattern.map(function (row) {
      const out = new Array(total);
      for (let s = 0; s < total; s++) out[s] = !!row[s % old];
      return out;
    });
    $('seqLen').value = String(n);
    $('bars').value = String(n);
    if (seq.playing && seq.step >= total) seq.step = 0;
    renderSeq();
  }

  // ---------- patterns ----------

  // Places every chop at the step where it starts in the original loop, so
  // pressing Play first gives back (roughly) the source groove.
  function patternOriginal() {
    const n = chopCount();
    const stepDur = 60 / S.bpm / 4;
    const total = totalSteps();
    S.pattern = [];
    for (let i = 0; i < n; i++) S.pattern.push(new Array(total).fill(false));
    // A loop shorter than the pattern repeats to fill it (a 1-bar loop
    // plays 4 times in the default 4 bars).
    const loopSteps = Math.max(1, Math.round(S.buffer.duration / stepDur / STEPS) * STEPS);
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const st0 = Math.round(S.markers[i] / S.buffer.sampleRate / stepDur);
      for (let st = st0; st < total; st += loopSteps) {
        if (!used.has(st)) { S.pattern[i][st] = true; used.add(st); }
        if (loopSteps >= total) break;
      }
    }
    renderSeq();
  }

  function patternFlip() {
    const n = chopCount();
    S.pattern = [];
    for (let i = 0; i < n; i++) S.pattern.push(new Array(totalSteps()).fill(false));
    // A chop on most 8th notes, choosing from the first 16 chops, with the
    // occasional 16th-note stutter. Each bar starts on a downbeat chop.
    const pool = Math.min(n, 16);
    for (let s = 0; s < totalSteps(); s++) {
      const r = Math.random();
      const down = s % STEPS === 0;
      if (down || (s % 2 === 0 && r < 0.75) || (s % 2 === 1 && r < 0.18)) {
        const c = s === 0 ? 0 : Math.floor(Math.random() * pool);
        S.pattern[c][s] = true;
      }
    }
    renderSeq();
    status('Flipped. Hit Play, or Flip it again.', 'ok');
  }

  // ---------- sequencer ----------

  const seq = { playing: false, step: 0, next: 0, timer: 0, queue: [] };

  function stepTime(stepIndex, base) {
    const dur = 60 / S.bpm / 4;
    return base + stepIndex * dur + (stepIndex % 2 ? S.swing * dur * 0.5 : 0);
  }

  function seqStart() {
    const ctx = SF.getContext();
    stopSample();
    seq.playing = true;
    seq.step = 0;
    seq.barStart = ctx.currentTime + 0.06;
    seq.queue = [];
    seq.timer = setInterval(seqTick, 25);
    seqTick();
    $('seqPlay').textContent = '■ Stop';
    $('seqPlay').classList.add('on');
    requestAnimationFrame(seqDraw);
  }

  function seqStop() {
    seq.playing = false;
    clearInterval(seq.timer);
    const ctx = SF.getContext();
    for (const v of S.voices) {
      try {
        v.gain.gain.setValueAtTime(v.gain.gain.value, ctx.currentTime);
        v.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
        v.src.stop(ctx.currentTime + 0.03);
      } catch (e) { /* already stopped */ }
    }
    S.voices = [];
    $('seqPlay').textContent = '▶ Play';
    $('seqPlay').classList.remove('on');
    markStep(-1);
  }

  function seqTick() {
    const ctx = SF.getContext();
    while (true) {
      const t = stepTime(seq.step, seq.barStart);
      if (t > ctx.currentTime + 0.12) break;
      for (let i = 0; i < chopCount(); i++) {
        if (S.pattern[i] && S.pattern[i][seq.step]) {
          startVoice(ctx, SF.master, i, Math.max(t, ctx.currentTime), S.voices);
          flashPad(i, (t - ctx.currentTime) * 1000);
        }
      }
      seq.queue.push({ step: seq.step, time: t });
      seq.step++;
      if (seq.step >= totalSteps()) {
        seq.step = 0;
        seq.barStart += totalSteps() * 60 / S.bpm / 4;
      }
    }
  }

  function seqDraw() {
    if (!seq.playing) return;
    const now = SF.getContext().currentTime;
    let cur = null;
    while (seq.queue.length && seq.queue[0].time <= now) cur = seq.queue.shift();
    if (cur) markStep(cur.step);
    requestAnimationFrame(seqDraw);
  }

  function markStep(s) {
    document.querySelectorAll('.cell.now, .seq-steps span.now').forEach(function (el) { el.classList.remove('now'); });
    if (s < 0) return;
    document.querySelectorAll('.cell[data-step="' + s + '"], .seq-steps span[data-step="' + s + '"]').forEach(function (el) {
      el.classList.add('now');
    });
  }

  function setBpm(v, note) {
    v = Math.round(Math.max(40, Math.min(240, v)) * 10) / 10;
    if (!isFinite(v)) return;
    S.bpm = v;
    $('bpm').value = v;
    if (note) status(note, 'ok');
  }

  // ---------- loading ----------

  function loadFile(file) {
    if (!file) return;
    status('Decoding ' + file.name + '…');
    file.arrayBuffer().then(function (ab) {
      return loadArrayBuffer(ab, file.name);
    }).catch(function (err) {
      decodeFailed(file.name, err);
    });
  }

  function decodeFailed(name, err) {
    console.error(err);
    const ext = (name.split('.').pop() || '').toLowerCase();
    let tip = 'Try converting it to WAV.';
    if (ext === 'mp4' || ext === 'm4a' || ext === 'mov') tip = 'This browser could not read the audio track. Chrome or Safari on a Mac read MP4/AAC; a video with no audio track, or HEVC/ALAC audio, may fail.';
    status('Could not decode "' + name + '". ' + tip, 'error');
  }

  function loadArrayBuffer(ab, name) {
    if (seq.playing) seqStop();
    stopSample();
    return SF.decode(ab).then(function (buffer) {
      if (!buffer || !buffer.length) throw new Error('empty audio');
      S.buffer = buffer;
      S.name = safeName(name);
      S.selected = -1;
      S.bank = 0;
      $('fileName').textContent = name;
      $('waveEmpty').hidden = true;
      wf.setBuffer(buffer);
      const fromName = SF.bpmFromName(name);
      if (fromName) {
        setBpm(SF.bpmFromLength(buffer.duration, fromName));
      } else {
        setBpm(SF.detectBPM(buffer));
      }
      // Every load starts on the default 4 bars; Length can shrink it.
      S.bars = 4;
      $('seqLen').value = String(S.bars);
      $('bars').value = String(S.bars);
      // Drums chop well on transients. Sustained material (chords, pads)
      // gives too few or too many, so slice it per bar instead.
      $('chopMode').value = 'transient';
      const hits = SF.detectTransients(buffer, $('sensitivity').value / 100, MAX_CHOPS, S.bpm).length;
      if (hits < 4 || hits > 32) {
        const bars = buffer.duration / (240 / S.bpm);
        const n = [4, 8, 16, 32].reduce(function (a, b) { return Math.abs(b - bars) < Math.abs(a - bars) ? b : a; });
        $('chopMode').value = 'equal';
        $('slices').value = String(n);
      }
      $('chopMode').dispatchEvent(new Event('change'));
      autoChop();
      selectChop(0, false);
      status('Loaded ' + name + ' · ' + chopCount() + ' chops · ' + S.bpm + ' BPM' +
        (fromName ? ' (from file name)' : ' (detected)') + '.', 'ok');
    }).catch(function (err) { decodeFailed(name, err); });
  }
  SF.loadArrayBuffer = loadArrayBuffer;

  // ---------- export ----------

  async function renderChopForExport(i) {
    const buf = chopBuffer(i);
    return SF.renderAtRate(buf, SF.rateFromSemis(S.flips[i].pitch));
  }

  function bitDepth() { return parseInt($('bitDepth').value, 10); }

  async function exportChops() {
    const n = chopCount();
    if (!n) return;
    status('Rendering ' + n + ' chops…');
    const name = S.name;
    const files = [];
    const pads = [];
    for (let i = 0; i < n; i++) {
      const b = await renderChopForExport(i);
      const sample = name + '_' + String(i + 1).padStart(2, '0');
      files.push({ name: name + '/' + sample + '.wav', data: SF.encodeWav(b, bitDepth()) });
      pads.push({ sampleName: sample, frames: b.length, choke: S.flips[i].choke, color: chopColorInt(i) });
    }
    const extras = [];
    if ($('withXpm').checked) {
      files.push({ name: name + '/' + name + '.xpm', data: new TextEncoder().encode(SF.buildXpm(name, pads)) });
      extras.push(name + '.xpm');
    }
    const notes = patternNotes(parseInt($('bars').value, 10));
    if ($('withPattern').checked && notes.length) {
      const pname = name + ' ' + String(S.bpm).replace('.', '_') + 'bpm.mpcpattern';
      files.push({ name: name + '/' + pname, data: new TextEncoder().encode(SF.buildMpcPattern(notes)) });
      extras.push(pname);
    }
    SF.download(SF.makeZip(files), name + '_chops.zip');
    status('Exported ' + n + ' chops' + (extras.length ? ' + ' + extras.join(' + ') : '') + '.', 'ok');
  }

  // The sequence as MPC notes: 960 ticks per quarter, 240 per 16th step.
  function patternNotes(bars) {
    // The pattern loops if more bars are asked for than it has.
    const notes = [];
    for (let k = 0; k < bars * STEPS; k++) {
      const s = k % totalSteps();
      const tick = k * 240 + (k % 2 ? S.swing * 120 : 0);
      for (let i = 0; i < Math.min(chopCount(), 128); i++) {
        if (S.pattern[i] && S.pattern[i][s]) notes.push({ tick: tick, pad: i, velocity: 1, len: 240 });
      }
    }
    return notes;
  }
  SF.patternNotes = patternNotes;

  async function exportOneChop() {
    const i = S.selected;
    if (i < 0) return;
    const b = await renderChopForExport(i);
    SF.download(new Blob([SF.encodeWav(b, bitDepth())], { type: 'audio/wav' }), S.name + '_' + padName(i) + '.wav');
  }

  async function renderPattern(bars) {
    const sr = S.buffer.sampleRate;
    const total = bars * STEPS * 60 / S.bpm / 4;
    const oc = new OfflineAudioContext(Math.max(2, S.buffer.numberOfChannels), Math.ceil(total * sr), sr);
    const voices = [];
    for (let k = 0; k < bars * STEPS; k++) {
      const s = k % totalSteps();
      const t = stepTime(k, 0);
      for (let i = 0; i < chopCount(); i++) {
        if (S.pattern[i] && S.pattern[i][s]) startVoice(oc, oc.destination, i, t, voices);
      }
    }
    return oc.startRendering();
  }
  SF.renderPattern = renderPattern;

  async function exportPattern() {
    const bars = parseInt($('bars').value, 10);
    if (!S.pattern.some(function (r) { return r.some(Boolean); })) {
      status('The pattern is empty. Add some steps first.', 'error');
      return;
    }
    status('Rendering pattern…');
    const out = await renderPattern(bars);
    const peak = SF.peak(out);
    const scale = peak > 0.99 ? 0.98 / peak : 1;
    const file = S.name + '_flip_' + String(S.bpm).replace('.', '_') + 'bpm_' + bars + 'bar.wav';
    SF.download(new Blob([SF.encodeWav(out, bitDepth(), scale)], { type: 'audio/wav' }), file);
    status('Exported ' + file + (scale < 1 ? ' (turned down ' + (20 * Math.log10(scale)).toFixed(1) + ' dB to avoid clipping)' : '') + '.', 'ok');
  }

  // ---------- wiring ----------

  const wf = new SF.Waveform($('wave'), $('overview'), {
    onChopClick: function (i) { if (i >= 0) selectChop(i, true); },
    onAddMarker: function (s) { addMarker(s); },
    onMarkerSelect: function (i) {
      $('delMarker').disabled = false;
      selectChop(i, false);
    },
    onMarkersChange: function () {
      S.cache = [];
      renderPads();
      renderEdit();
      if (S.selected >= 0) playChop(S.selected);
    },
    onDeleteMarker: function (i) { deleteMarker(i); },
  });
  wf.colorFor = chopColor;

  $('file').addEventListener('change', function (e) { loadFile(e.target.files[0]); e.target.value = ''; });
  $('playSample').addEventListener('click', playSample);
  $('tapMark').addEventListener('click', function () {
    if (!samplePlay) { playSample(); status('Playing. Tap "Tap chop" (or press M) on each hit.'); return; }
    addMarker(samplePos());
  });
  $('markMode').addEventListener('click', function () {
    wf.markMode = !wf.markMode;
    $('markMode').setAttribute('aria-pressed', String(wf.markMode));
  });
  $('delMarker').addEventListener('click', function () {
    if (wf.selectedMarker >= 0) deleteMarker(wf.selectedMarker);
  });
  $('chopMode').addEventListener('change', function () {
    const eq = $('chopMode').value === 'equal';
    $('sensWrap').hidden = eq;
    $('slices').hidden = !eq;
  });
  $('chopBtn').addEventListener('click', autoChop);
  $('sensitivity').addEventListener('change', autoChop);
  $('slices').addEventListener('change', autoChop);
  $('clearMarkers').addEventListener('click', function () {
    S.pattern = [];
    S.selected = -1;
    setMarkers([0], false);
    selectChop(0, false);
  });
  $('zoomIn').addEventListener('click', function () { wf.zoom(0.5); });
  $('zoomOut').addEventListener('click', function () { wf.zoom(2); });
  $('zoomFit').addEventListener('click', function () { wf.setView(0, S.buffer.length); });

  // Flip controls.
  function bindFlip(id, key, parse) {
    $(id).addEventListener('input', function (e) {
      const i = S.selected;
      if (i < 0) return;
      S.flips[i][key] = parse(e.target);
      S.cache[i] = null;
      renderEditOutputs(S.flips[i]);
    });
    $(id).addEventListener('change', function () {
      if (S.selected < 0) return;
      renderPads();
      playChop(S.selected);
    });
  }
  bindFlip('fReverse', 'reverse', function (el) { return el.checked; });
  bindFlip('fChoke', 'choke', function (el) { return el.checked; });
  bindFlip('fPitch', 'pitch', function (el) { return parseInt(el.value, 10); });
  bindFlip('fGain', 'gain', function (el) { return parseFloat(el.value); });
  bindFlip('fFadeIn', 'fadeIn', function (el) { return parseInt(el.value, 10); });
  bindFlip('fFadeOut', 'fadeOut', function (el) { return parseInt(el.value, 10); });
  $('resetFlip').addEventListener('click', function () {
    if (S.selected < 0) return;
    S.flips[S.selected] = Object.assign({}, DEFAULT_FLIP);
    S.cache[S.selected] = null;
    renderEdit();
    renderPads();
  });
  $('applyAll').addEventListener('click', function () {
    if (S.selected < 0) return;
    const f = S.flips[S.selected];
    for (let i = 0; i < chopCount(); i++) S.flips[i] = Object.assign({}, f);
    S.cache = [];
    renderPads();
    status('Copied ' + padName(S.selected) + ' flips to all chops.', 'ok');
  });
  $('auditionBtn').addEventListener('click', function () { playChop(S.selected); });
  $('exportChop').addEventListener('click', function () { exportOneChop().catch(exportFailed); });

  // Sequencer controls.
  $('seqPlay').addEventListener('click', function () { seq.playing ? seqStop() : seqStart(); });
  $('bpm').addEventListener('change', function (e) { setBpm(parseFloat(e.target.value)); });
  $('bpmDetect').addEventListener('click', function () {
    setBpm(SF.detectBPM(S.buffer), 'Detected tempo: ' + SF.detectBPM(S.buffer) + ' BPM. Use ½ or ×2 if it is off by an octave.');
  });
  $('bpmHalf').addEventListener('click', function () { setBpm(S.bpm / 2); });
  $('bpmDouble').addEventListener('click', function () { setBpm(S.bpm * 2); });
  const taps = [];
  $('tapTempo').addEventListener('click', function () {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 3) setBpm(60000 * (taps.length - 1) / (now - taps[0]));
  });
  $('swing').addEventListener('input', function (e) {
    S.swing = e.target.value / 100;
    $('oSwing').textContent = e.target.value + '%';
  });
  $('patOriginal').addEventListener('click', patternOriginal);
  $('seqLen').addEventListener('change', function (e) { setBars(parseInt(e.target.value, 10)); });
  $('patFlip').addEventListener('click', patternFlip);
  $('patClear').addEventListener('click', function () {
    S.pattern = S.pattern.map(function () { return new Array(totalSteps()).fill(false); });
    renderSeq();
  });

  function exportFailed(err) {
    console.error(err);
    status('Export failed: ' + (err && err.message ? err.message : err), 'error');
  }
  $('exportChops').addEventListener('click', function () { exportChops().catch(exportFailed); });
  $('exportPattern').addEventListener('click', function () { exportPattern().catch(exportFailed); });

  // Keyboard.
  document.addEventListener('keydown', function (e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if ((tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox') || tag === 'select' || tag === 'textarea') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const p = PAD_KEYS.indexOf(k);
    if (p >= 0) {
      if (!e.repeat) {
        const i = S.bank * 16 + p;
        if (i < chopCount()) selectChop(i, true);
      }
      e.preventDefault();
      return;
    }
    if (!S.buffer) return;
    if (k === ' ') {
      e.preventDefault();
      if (chopCount()) seq.playing ? seqStop() : seqStart();
    } else if (k === 'p') {
      playSample();
    } else if (k === 'm') {
      if (samplePlay) addMarker(samplePos());
    } else if ((k === 'delete' || k === 'backspace') && wf.selectedMarker >= 0) {
      e.preventDefault();
      deleteMarker(wf.selectedMarker);
    }
  });

  // Drag and drop anywhere on the page.
  let dragDepth = 0;
  window.addEventListener('dragenter', function (e) { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  SF.state = S;
  renderAll();
})(window.SF = window.SF || {});
