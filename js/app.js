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
    bpm: 90,        // the sample's own tempo (Sample BPM)
    tempo: 90,      // what the beat and the pattern play at (Tempo)
    tempoSet: false, // true once you set the Tempo yourself; until then it follows Sample BPM
    warp: 'stretch', // how chops fit the Tempo: 'stretch' (keep pitch), 'repitch' or 'off'
    warped: [],     // time-stretched chops per chop index, for the current Tempo
    beatStyle: 'neosoul',
    beatLevel: 0.7,
    beatFills: true,
    beatWithPlay: true,
    swing: 0,
    voices: [],
    history: [],    // buffers before each Keep / Cut, for Undo
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
    const vb = voiceBuffer(i); // warped to the Tempo
    const buf = vb.buf;
    const rate = vb.rate;
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
    // With a selection, play just that range so the trim can be heard first.
    const sel = wf.selection;
    const offset = sel ? sel.a / S.buffer.sampleRate : 0;
    if (sel) src.start(ctx.currentTime, offset, (sel.b - sel.a) / S.buffer.sampleRate);
    else src.start(ctx.currentTime, offset);
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
    resetFlips();
    if ($('chopMode').value === 'transient' && chopCount() < 4) {
      // Chords, pads and full songstarters have few sharp hits.
      status('Only ' + chopCount() + ' hit' + (chopCount() === 1 ? '' : 's') + ' found: this sounds sustained. ' +
        'Switch to Equal slices, raise Sensitivity, or add markers by hand.', 'error');
    } else {
      status(chopCount() + ' chops.', 'ok');
    }
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
      'zoomIn', 'zoomOut', 'zoomFit', 'bpmDetect', 'selMode'].forEach(function (id) { $(id).disabled = !has; });
    renderTrim();
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
    const perBar = SF.Beat.steps(S.beatStyle) / 4;
    txt += ' · ' + (Math.round(b.duration / (60 * perBar / S.bpm) * 100) / 100) + ' bars at ' + S.bpm + ' BPM';
    const sel = wf.selection;
    if (sel) {
      const sec = (sel.b - sel.a) / b.sampleRate;
      const bars = sec / (240 / S.bpm);
      txt += ' · selection ' + fmtTime(sec) + ' = ' + (Math.round(bars * 100) / 100) + ' bar' + (bars === 1 ? '' : 's') +
        ' at ' + S.bpm + ' BPM';
    }
    $('info').textContent = txt;
  }

  function renderTrim() {
    const sel = !!wf.selection;
    $('keepSel').disabled = !sel;
    $('cutSel').disabled = !sel;
    $('undoEdit').disabled = !S.history.length;
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

  // The original groove as one chop per step (-1 = rest): each chop at the
  // step where it starts in the loop. A loop shorter than the pattern
  // repeats to fill it (a 1-bar loop plays 4 times in the default 4 bars).
  function originalGrid() {
    const stepDur = 60 / S.bpm / 4;
    const total = totalSteps();
    const grid = new Array(total).fill(-1);
    const loopSteps = Math.max(1, Math.round(S.buffer.duration / stepDur / STEPS) * STEPS);
    for (let i = 0; i < chopCount(); i++) {
      const st0 = Math.round(S.markers[i] / S.buffer.sampleRate / stepDur);
      for (let st = st0; st < total; st += loopSteps) {
        if (grid[st] < 0) grid[st] = i;
        if (loopSteps >= total) break;
      }
    }
    return grid;
  }

  // Writes a one-chop-per-step grid into the pattern (clearing everything else).
  function setPatternFromGrid(grid) {
    S.pattern = [];
    for (let i = 0; i < chopCount(); i++) S.pattern.push(new Array(totalSteps()).fill(false));
    grid.forEach(function (c, st) { if (c >= 0 && c < chopCount()) S.pattern[c][st] = true; });
    renderSeq();
  }

  // Pressing Play first gives back (roughly) the source groove.
  function patternOriginal() {
    setPatternFromGrid(originalGrid());
  }

  // ---------- auto-flip ----------

  function rnd(n) { return Math.floor(Math.random() * n); }
  function chance(p) { return Math.random() < p; }

  function shuffled(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const k = rnd(i + 1);
      const t = a[i]; a[i] = a[k]; a[k] = t;
    }
    return a;
  }

  // Each style turns the pool (the pads of the current bank, A01-A16) into a
  // one-chop-per-step grid. `orig` is the original groove.
  const FLIP_STYLES = {
    // A chop on most 8ths, the occasional 16th, each bar on a downbeat chop.
    random: function (pool, total) {
      const g = new Array(total).fill(-1);
      for (let s = 0; s < total; s++) {
        const r = Math.random();
        if (s % STEPS === 0 || (s % 2 === 0 && r < 0.75) || (s % 2 === 1 && r < 0.18)) {
          g[s] = s === 0 ? pool[0] : pool[rnd(pool.length)];
        }
      }
      return g;
    },
    // Same rhythm as the original, chops swapped around.
    shuffle: function (pool, total, orig) {
      const map = shuffled(pool);
      return orig.map(function (c) { return c < 0 ? -1 : map[poolIndex(pool, c)]; });
    },
    // Hits on the beats with gaps between, plus the odd pickup 16th.
    stab: function (pool, total) {
      const g = new Array(total).fill(-1);
      for (let s = 0; s < total; s++) {
        const k = s % 4;
        if ((k === 0 && (s % STEPS === 0 || chance(0.8))) || (k === 3 && chance(0.25)) || (k === 2 && chance(0.15))) {
          g[s] = pool[rnd(pool.length)];
        }
      }
      return g;
    },
    // A chop per beat; some beats roll it as 16ths or 8ths, more often at the end of a bar.
    stutter: function (pool, total) {
      const g = new Array(total).fill(-1);
      for (let b = 0; b < total; b += 4) {
        const c = pool[rnd(pool.length)];
        const r = Math.random();
        const lastBeat = b % STEPS === STEPS - 4;
        if (r < (lastBeat ? 0.65 : 0.3)) { for (let k = 0; k < 4; k++) g[b + k] = c; }
        else if (r < 0.55) { g[b] = c; g[b + 2] = c; }
        else { g[b] = c; if (chance(0.4)) g[b + 2] = pool[rnd(pool.length)]; }
      }
      return g;
    },
    // The original groove at half speed: every hit twice as far apart.
    half: function (pool, total, orig) {
      const g = new Array(total).fill(-1);
      for (let s = 0; s < total; s += 2) g[s] = orig[s / 2];
      return g;
    },
    // Same rhythm as the original, chops in reverse order (A16 where A01 was).
    reverse: function (pool, total, orig) {
      return orig.map(function (c) { return c < 0 ? -1 : pool[pool.length - 1 - poolIndex(pool, c)]; });
    },
    // Bars 1 and 3 keep the original, bars 2 and 4 answer with a flip.
    callresp: function (pool, total, orig) {
      const answer = FLIP_STYLES.random(pool, total);
      const half = total <= STEPS ? STEPS / 2 : STEPS; // 1 bar: call and answer are half a bar each
      return orig.map(function (c, s) { return Math.floor(s / half) % 2 ? answer[s] : c; });
    },
  };
  const FLIP_NAMES = {
    random: 'Random', shuffle: 'Shuffle', stab: 'Chop & stab', stutter: 'Stutter',
    half: 'Half-time', reverse: 'Reverse order', callresp: 'Call & response',
  };

  // Chops from other banks map onto the pool by their pad number.
  function poolIndex(pool, c) {
    const k = pool.indexOf(c);
    return k >= 0 ? k : c % pool.length;
  }

  // The last flips, so a good one can be found again. `at` is the one showing.
  const flipHistory = { list: [], at: -1 };
  const MAX_FLIPS = 20;

  function patternFlip() {
    const first = S.bank * 16;
    const pool = [];
    for (let i = first; i < Math.min(chopCount(), first + 16); i++) pool.push(i);
    if (!pool.length) return;
    const style = $('flipStyle').value;
    // Keep any edits made to the flip that's showing before adding a new one.
    saveFlip();
    setPatternFromGrid(FLIP_STYLES[style](pool, totalSteps(), originalGrid()));
    flipHistory.list = flipHistory.list.slice(0, flipHistory.at + 1);
    flipHistory.list.push({ style: style, pattern: copyPattern() });
    if (flipHistory.list.length > MAX_FLIPS) flipHistory.list.shift();
    flipHistory.at = flipHistory.list.length - 1;
    renderFlipNav();
    status('Flip ' + (flipHistory.at + 1) + ': ' + FLIP_NAMES[style] + '. Hit Play, Flip it again, or use ◀ ▶ to go back to an earlier flip.', 'ok');
  }

  function copyPattern() { return S.pattern.map(function (r) { return r.slice(); }); }

  function saveFlip() {
    const f = flipHistory.list[flipHistory.at];
    if (f && f.pattern.length === S.pattern.length) f.pattern = copyPattern();
  }

  function showFlip(at) {
    if (at < 0 || at >= flipHistory.list.length) return;
    saveFlip();
    flipHistory.at = at;
    const f = flipHistory.list[at];
    // A flip made at another length is repeated or cut to fit, like Length does.
    const total = totalSteps();
    // Chops added or deleted since then get empty rows or are dropped.
    S.pattern = [];
    for (let i = 0; i < chopCount(); i++) {
      const row = f.pattern[i];
      const out = new Array(total).fill(false);
      if (row) for (let s = 0; s < total; s++) out[s] = !!row[s % row.length];
      S.pattern.push(out);
    }
    renderSeq();
    renderFlipNav();
    status('Flip ' + (at + 1) + ' of ' + flipHistory.list.length + ': ' + FLIP_NAMES[f.style] + '.', 'ok');
  }

  function renderFlipNav() {
    const n = flipHistory.list.length;
    $('flipPrev').disabled = flipHistory.at <= 0;
    $('flipNext').disabled = flipHistory.at >= n - 1;
    $('flipCount').textContent = n ? (flipHistory.at + 1) + '/' + n : '';
  }

  function resetFlips() {
    flipHistory.list = [];
    flipHistory.at = -1;
    renderFlipNav();
  }

  // ---------- clock: the sequencer and the drum beat ----------
  //
  // One clock runs both, one 16th-note step at a time at the Tempo, so they
  // can't drift apart. Whichever starts second waits for bar 1 of the one
  // already playing. Each step's time is worked out from the tempo as it is
  // then, so changing the tempo or the style mid-play stays in time.
  // The chops are warped from the sample's own tempo (Sample BPM) to the Tempo.

  const seq = { playing: false, pending: false, step: 0, queue: [], withBeat: false };
  const beat = { on: false, pending: false, step: 0, bar: 0, ui: [], taps: [] };
  const clock = { running: false, next: 0, timer: 0 };

  // For the offline render (Pattern .wav): step k of a pattern starting at base.
  function stepTime(stepIndex, base) {
    const dur = 60 / S.tempo / 4;
    return base + stepIndex * dur + (stepIndex % 2 ? S.swing * dur * 0.5 : 0);
  }

  function clockStart() {
    if (clock.running) return;
    const ctx = SF.getContext();
    clock.running = true;
    clock.next = ctx.currentTime + 0.06;
    clock.timer = setInterval(clockTick, 25);
    clockTick();
    requestAnimationFrame(clockDraw);
  }

  function clockCheck() {
    if (seq.playing || seq.pending || beat.on || beat.pending) return;
    clearInterval(clock.timer);
    clock.running = false;
  }

  // Schedules every step that falls in the next 120 ms.
  function clockTick() {
    const ctx = SF.getContext();
    while (clock.next < ctx.currentTime + 0.12) clockStep(ctx, clock.next);
  }

  function clockStep(ctx, t) {
    // Newcomers come in on bar 1 of whatever is already playing.
    if (beat.pending && (!seq.playing || seq.step % STEPS === 0)) {
      beat.pending = false; beat.on = true; beat.step = 0; beat.bar = 0;
    }
    if (seq.pending && (!beat.on || beat.step === 0)) {
      seq.pending = false; seq.playing = true; seq.step = 0;
    }
    if (beat.on) {
      const n = SF.Beat.steps(S.beatStyle);
      if (beat.step >= n) { beat.step = 0; beat.bar++; } // style changed to 3/4 mid-bar
      SF.Beat.playStep(S.beatStyle, beat.step, beat.bar,
        t + SF.Beat.swingOffset(S.beatStyle, beat.step, S.tempo), S.beatFills);
      beat.ui.push({ t: t, step: beat.step, bar: beat.bar });
      if (++beat.step >= n) { beat.step = 0; beat.bar++; }
    }
    if (seq.playing) {
      if (seq.step >= totalSteps()) seq.step = 0;
      const ts = t + (seq.step % 2 ? S.swing * (60 / S.tempo / 4) * 0.5 : 0);
      for (let i = 0; i < chopCount(); i++) {
        if (S.pattern[i] && S.pattern[i][seq.step]) {
          startVoice(ctx, SF.master, i, Math.max(ts, ctx.currentTime), S.voices);
          flashPad(i, (ts - ctx.currentTime) * 1000);
        }
      }
      seq.queue.push({ step: seq.step, time: t });
      if (++seq.step >= totalSteps()) seq.step = 0;
    }
    clock.next = t + 60 / S.tempo / 4;
  }

  let shownTransport = '';
  function clockDraw() {
    const now = SF.getContext().currentTime;
    let cur = null;
    while (seq.queue.length && seq.queue[0].time <= now) cur = seq.queue.shift();
    if (cur) markStep(cur.step);
    let b = null;
    while (beat.ui.length && beat.ui[0].t <= now) b = beat.ui.shift();
    if (b) showBeat(b);
    const key = [seq.playing, seq.pending, beat.on, beat.pending].join();
    if (key !== shownTransport) renderTransport();
    if (clock.running) requestAnimationFrame(clockDraw);
  }

  function seqStart() {
    if (!S.buffer || !chopCount()) return;
    SF.getContext();
    stopSample();
    seq.pending = true;
    seq.step = 0;
    seq.queue = [];
    // "Drums with ▶ Play": both start together on bar 1, and ■ Stop stops both.
    seq.withBeat = S.beatWithPlay && !beat.on && !beat.pending;
    if (seq.withBeat) beatArm();
    prewarm(true);
    clockStart();
    renderTransport();
  }

  // keepBeat: leave drums that ▶ Play started running (used when loading or trimming).
  function seqStop(keepBeat) {
    seq.playing = false;
    seq.pending = false;
    const ctx = SF.getContext();
    for (const v of S.voices) {
      try {
        v.gain.gain.setValueAtTime(v.gain.gain.value, ctx.currentTime);
        v.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.02);
        v.src.stop(ctx.currentTime + 0.03);
      } catch (e) { /* already stopped */ }
    }
    S.voices = [];
    seq.queue = [];
    markStep(-1);
    if (seq.withBeat && !keepBeat) beatStop();
    seq.withBeat = false;
    clockCheck();
    renderTransport();
  }

  function beatArm() {
    SF.Beat.bus(S.beatLevel);
    beat.pending = true;
    beat.ui = [];
  }

  function beatButton() {
    if (beat.on || beat.pending) return beatStop();
    beatArm();
    clockStart();
    renderTransport();
  }

  function beatStop() {
    beat.on = false;
    beat.pending = false;
    beat.ui = [];
    seq.withBeat = false;
    SF.Beat.silence();
    clockCheck();
    showBeat(null);
    renderTransport();
  }

  function renderTransport() {
    shownTransport = [seq.playing, seq.pending, beat.on, beat.pending].join();
    const p = $('seqPlay');
    p.textContent = seq.playing ? '■ Stop' : seq.pending ? '… bar 1' : '▶ Play';
    p.classList.toggle('on', seq.playing || seq.pending);
    const g = $('beatGo');
    g.textContent = beat.on ? '■ Beat' : beat.pending ? '… bar 1' : '▶ Beat';
    g.classList.toggle('on', beat.on || beat.pending);
    renderTempoInfo();
  }

  function showBeat(pos) {
    const n = SF.Beat.steps(S.beatStyle) / 4;
    const at = pos ? Math.floor(pos.step / 4) : -1;
    document.querySelectorAll('#beatDots i').forEach(function (d, i) {
      d.classList.toggle('on', beat.on && i === at);
      d.classList.toggle('one', i === 0);
      d.style.display = i < n ? '' : 'none';
    });
    const bar = $('beatBar');
    const fill = pos && S.beatFills && SF.Beat.BEATS[S.beatStyle].fill !== false && pos.bar % 4 === 3;
    bar.textContent = beat.on && pos ? 'Bar ' + (pos.bar + 1) + (fill ? ' · fill' : '') : '';
  }

  function markStep(s) {
    document.querySelectorAll('.cell.now, .seq-steps span.now').forEach(function (el) { el.classList.remove('now'); });
    if (s < 0) return;
    document.querySelectorAll('.cell[data-step="' + s + '"], .seq-steps span[data-step="' + s + '"]').forEach(function (el) {
      el.classList.add('now');
    });
  }

  // ---------- tempo and warp ----------

  // How much faster than its own tempo the sample plays (1 = as recorded).
  function warpRatio() {
    return S.buffer && S.bpm > 0 ? S.tempo / S.bpm : 1;
  }
  SF.warpRatio = warpRatio;

  // The buffer and playback rate a chop plays with at the current tempo.
  // Keep pitch: the chop is time-stretched (cached per tempo).
  // Repitch: it plays faster or slower, so the pitch moves too, like a record.
  // Off: as recorded; each chop still starts on its step.
  function voiceBuffer(i) {
    const base = chopBuffer(i);
    const pitch = SF.rateFromSemis(S.flips[i].pitch);
    const r = warpRatio();
    if (S.warp === 'off' || Math.abs(r - 1) < 0.002) return { buf: base, rate: pitch };
    if (S.warp === 'repitch') return { buf: base, rate: pitch * r };
    const factor = Math.round(1e4 / r) / 1e4;
    const w = S.warped[i];
    if (w && w.src === base && w.factor === factor) return { buf: w.out, rate: pitch };
    const out = SF.stretch(base, factor);
    S.warped[i] = { src: base, factor: factor, out: out };
    return { buf: out, rate: pitch };
  }

  // Stretches the chops ahead of time so playback doesn't have to.
  // now: do the chops the pattern uses right away (before Play starts).
  let prewarmTimer = 0;
  function prewarm(now) {
    clearTimeout(prewarmTimer);
    if (!S.buffer || S.warp !== 'stretch' || Math.abs(warpRatio() - 1) < 0.002) return;
    const used = [], rest = [];
    for (let i = 0; i < chopCount(); i++) (S.pattern[i] && S.pattern[i].some(Boolean) ? used : rest).push(i);
    if (now) used.forEach(voiceBuffer);
    const todo = now ? rest : used.concat(rest);
    const next = function () {
      const i = todo.shift();
      if (i == null) return;
      if (i < chopCount()) voiceBuffer(i);
      prewarmTimer = setTimeout(next, 0);
    };
    prewarmTimer = setTimeout(next, now ? 0 : 150);
  }

  // Sample BPM: the sample's own tempo. Until you set the Tempo yourself
  // (type it, Tap it), the Tempo follows it, so nothing is warped.
  function setBpm(v, note) {
    v = Math.round(Math.max(40, Math.min(240, v)) * 10) / 10;
    if (!isFinite(v)) return;
    S.bpm = v;
    $('bpm').value = v;
    if (!S.tempoSet) setTempo(v);
    renderTempoInfo();
    renderInfo();
    prewarm(false);
    if (note) status(note, 'ok');
  }

  // Tempo: what the beat and the pattern play at.
  function setTempo(v, byUser) {
    v = Math.round(Math.max(40, Math.min(240, v)) * 10) / 10;
    if (!isFinite(v)) return;
    S.tempo = v;
    if (byUser) S.tempoSet = true;
    $('tempo').value = v;
    renderTempoInfo();
    prewarm(false);
    saveBeat();
  }

  function renderTempoInfo() {
    const el = $('tempoInfo');
    if (!S.buffer) { el.textContent = 'Load a sample: its chops play in time with the beat.'; return; }
    const r = warpRatio();
    let txt = 'Sample ' + S.bpm + ' BPM';
    if (Math.abs(r - 1) < 0.002) {
      txt += ' = Tempo, so it plays as recorded.';
    } else {
      const pct = Math.round(Math.abs(r - 1) * 100);
      const how = S.warp === 'stretch' ? 'stretched ' + pct + '% ' + (r > 1 ? 'faster' : 'slower') + ', same pitch'
        : S.warp === 'repitch' ? (r > 1 ? 'sped up ' : 'slowed down ') + pct + '%, pitch ' +
          (r > 1 ? '+' : '−') + Math.abs(12 * Math.log2(r)).toFixed(1) + ' st'
        : 'not warped: each chop starts on its step, ' + (r > 1 ? 'long ones get cut off' : 'with gaps between');
      txt += ' → plays at ' + S.tempo + ' (' + how + ').';
    }
    el.textContent = txt;
    $('matchBeat').disabled = Math.abs(r - 1) < 0.002;
  }

  function saveBeat() {
    try {
      localStorage.setItem('sf.beat', JSON.stringify({
        beatStyle: S.beatStyle, beatLevel: S.beatLevel, beatFills: S.beatFills, beatWithPlay: S.beatWithPlay,
        warp: S.warp, tempo: S.tempo, tempoSet: S.tempoSet,
      }));
    } catch (e) { /* private mode */ }
  }

  function loadBeatPrefs() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('sf.beat') || '{}') || {}; } catch (e) { /* ignore */ }
    if (p.beatStyle && SF.Beat.BEATS[p.beatStyle]) S.beatStyle = p.beatStyle;
    if (typeof p.beatLevel === 'number') S.beatLevel = p.beatLevel;
    if (typeof p.beatFills === 'boolean') S.beatFills = p.beatFills;
    if (typeof p.beatWithPlay === 'boolean') S.beatWithPlay = p.beatWithPlay;
    if (['stretch', 'repitch', 'off'].indexOf(p.warp) >= 0) S.warp = p.warp;
    if (p.tempoSet && p.tempo >= 40 && p.tempo <= 240) { S.tempo = p.tempo; S.tempoSet = true; }
  }

  // "Loop is N bars": the sample's tempo from its length.
  function setLoopBars(n) {
    if (!S.buffer) return;
    if (!n) {
      const fromName = SF.bpmFromName(S.name);
      setBpm(fromName ? SF.bpmFromLength(S.buffer.duration, fromName) : SF.detectBPM(S.buffer));
      return;
    }
    const perBar = SF.Beat.steps(S.beatStyle) / 4; // beats in a bar (3 for the 3/4 styles)
    setBpm(60 * n * perBar / S.buffer.duration, 'Sample is ' + n + ' bar' + (n > 1 ? 's' : '') + ' long, so its tempo is ' +
      (Math.round(600 * n * perBar / S.buffer.duration) / 10) + ' BPM.');
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
    if (seq.playing || seq.pending) seqStop(true);
    stopSample();
    return SF.decode(ab).then(function (buffer) {
      if (!buffer || !buffer.length) throw new Error('empty audio');
      S.name = safeName(name);
      S.history = [];
      $('fileName').textContent = name;
      $('waveEmpty').hidden = true;
      const fromName = SF.bpmFromName(name);
      if (fromName) {
        setBpm(SF.bpmFromLength(buffer.duration, fromName));
      } else {
        setBpm(SF.detectBPM(buffer));
      }
      useBuffer(buffer);
      status('Loaded ' + name + ' · ' + chopCount() + ' chops · ' + S.bpm + ' BPM' +
        (fromName ? ' (from file name)' : ' (detected)') + '.', 'ok');
    }).catch(function (err) { decodeFailed(name, err); });
  }
  SF.loadArrayBuffer = loadArrayBuffer;

  // Shows a buffer and chops it. Used on load and after every Keep / Cut / Undo.
  function useBuffer(buffer) {
    if (seq.playing || seq.pending) seqStop(true);
    stopSample();
    S.buffer = buffer;
    S.warped = [];
    $('loopBars').value = '0';
    S.selected = -1;
    S.bank = 0;
    wf.setBuffer(buffer);
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
    renderTempoInfo();
  }

  // ---------- trim ----------

  // Keep: trim the sample to the selection. Cut: remove the selection and
  // join the two sides. Either way the sample is chopped again from scratch.
  function editBuffer(kind) {
    const sel = wf.selection;
    if (!S.buffer || !sel) return;
    const src = S.buffer;
    // Land both edges on zero crossings so the new start, end or join doesn't click.
    const a = sel.a <= 0 ? 0 : SF.snapZero(src, sel.a);
    const b = sel.b >= src.length ? src.length : SF.snapZero(src, sel.b);
    const len = kind === 'keep' ? b - a : src.length - (b - a);
    if (len < src.sampleRate * 0.05) {
      status(kind === 'keep' ? 'Selection is too short to keep.' : 'That would cut almost everything. Use Keep instead.', 'error');
      return;
    }
    const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length: len, sampleRate: src.sampleRate });
    for (let c = 0; c < src.numberOfChannels; c++) {
      const x = src.getChannelData(c);
      const y = out.getChannelData(c);
      if (kind === 'keep') {
        y.set(x.subarray(a, b));
      } else {
        y.set(x.subarray(0, a));
        y.set(x.subarray(b), a);
      }
    }
    S.history.push(src);
    if (S.history.length > 20) S.history.shift();
    useBuffer(out);
    const bars = out.duration / (240 / S.bpm);
    status((kind === 'keep' ? 'Trimmed to ' : 'Cut. Now ') + fmtTime(out.duration) + ' (' +
      (Math.round(bars * 100) / 100) + ' bars) · ' + chopCount() + ' chops. Undo puts it back.', 'ok');
  }

  function undoEdit() {
    if (!S.history.length) return;
    useBuffer(S.history.pop());
    status('Undone · ' + fmtTime(S.buffer.duration) + ' · ' + chopCount() + ' chops.', 'ok');
  }

  // Selection edges snap to the beat grid (counted from the start of the
  // sample) when Snap to beat is on.
  function snapToBeat(s) {
    if (!S.buffer || !$('snapBeat').checked) return s;
    const len = 60 / S.bpm * S.buffer.sampleRate;
    return Math.min(S.buffer.length, Math.round(s / len) * len);
  }

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
      const pname = name + ' ' + String(S.tempo).replace('.', '_') + 'bpm.mpcpattern';
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
    const total = bars * STEPS * 60 / S.tempo / 4;
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
    const file = S.name + '_flip_' + String(S.tempo).replace('.', '_') + 'bpm_' + bars + 'bar.wav';
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
    onSelectionChange: function () { renderTrim(); renderInfo(); },
  });
  wf.colorFor = chopColor;
  wf.snap = snapToBeat;

  $('file').addEventListener('change', function (e) { loadFile(e.target.files[0]); e.target.value = ''; });
  $('playSample').addEventListener('click', playSample);
  $('tapMark').addEventListener('click', function () {
    if (!samplePlay) { playSample(); status('Playing. Tap "Tap chop" (or press M) on each hit.'); return; }
    addMarker(samplePos());
  });
  // + Marker and Select both use clicks on the waveform, so only one is on at a time.
  function setMarkMode(on) {
    wf.markMode = on;
    $('markMode').setAttribute('aria-pressed', String(on));
    if (on) {
      setSelectMode(false);
      status('Click the waveform to add a chop there. Drag a marker to move it; right-click it to delete. Double-click also adds a chop in any mode.');
    }
  }
  function setSelectMode(on) {
    wf.selectMode = on;
    $('selMode').setAttribute('aria-pressed', String(on));
    if (on) {
      setMarkMode(false);
      status('Drag across the waveform to select. Drag the yellow edges to adjust. ▶ Sample plays the selection.');
    }
  }
  $('markMode').addEventListener('click', function () { setMarkMode(!wf.markMode); });
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
    status('Chops cleared: the whole sample is on A01. Press Chop to chop again, or turn on + Marker (or double-click the waveform) to add chops by hand.');
  });
  $('selMode').addEventListener('click', function () { setSelectMode(!wf.selectMode); });
  $('keepSel').addEventListener('click', function () { editBuffer('keep'); });
  $('cutSel').addEventListener('click', function () { editBuffer('cut'); });
  $('undoEdit').addEventListener('click', undoEdit);
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
  $('seqPlay').addEventListener('click', function () { seq.playing || seq.pending ? seqStop() : seqStart(); });
  $('loopBars').addEventListener('change', function (e) { setLoopBars(parseInt(e.target.value, 10)); });

  // Beat controls.
  Object.keys(SF.Beat.BEATS).forEach(function (id) {
    const b = SF.Beat.BEATS[id];
    $('beatStyle').add(new Option(b.name + ' · ' + b.bpm, id));
  });
  $('beatGo').addEventListener('click', beatButton);
  $('beatStyle').addEventListener('change', function (e) {
    S.beatStyle = e.target.value; showBeat(null); renderInfo(); saveBeat(); e.target.blur();
  });
  $('tempo').addEventListener('change', function (e) { setTempo(parseFloat(e.target.value), true); });
  $('tempoTap').addEventListener('click', function () {
    const now = performance.now();
    beat.taps = beat.taps.filter(function (t) { return now - t < 2500; }).concat(now);
    if (beat.taps.length >= 2) {
      const gaps = beat.taps.slice(1).map(function (t, i) { return t - beat.taps[i]; });
      setTempo(Math.round(60000 / (gaps.reduce(function (a, b) { return a + b; }) / gaps.length)), true);
    }
  });
  $('beatLevel').addEventListener('input', function (e) { S.beatLevel = +e.target.value; SF.Beat.bus(S.beatLevel); saveBeat(); });
  $('beatFills').addEventListener('change', function (e) { S.beatFills = e.target.checked; saveBeat(); });
  $('beatWithPlay').addEventListener('change', function (e) { S.beatWithPlay = e.target.checked; saveBeat(); });
  $('warp').addEventListener('change', function (e) {
    S.warp = e.target.value; renderTempoInfo(); prewarm(false); saveBeat(); e.target.blur();
  });
  $('matchBeat').addEventListener('click', function () {
    S.tempoSet = false;
    setTempo(S.bpm);
    status('Tempo set to the sample\'s ' + S.bpm + ' BPM. It follows the sample again until you change it.', 'ok');
  });
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
  $('flipPrev').addEventListener('click', function () { showFlip(flipHistory.at - 1); });
  $('flipNext').addEventListener('click', function () { showFlip(flipHistory.at + 1); });
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
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && S.history.length) {
      e.preventDefault();
      undoEdit();
      return;
    }
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
    if (k === 'b') {
      beatButton();
      return;
    }
    if (!S.buffer) return;
    if (k === ' ') {
      e.preventDefault();
      if (chopCount()) seq.playing || seq.pending ? seqStop() : seqStart();
    } else if (k === 'p') {
      playSample();
    } else if (k === 'm') {
      if (samplePlay) addMarker(samplePos());
    } else if (k === 'escape' && wf.selection) {
      wf.setSelection(null);
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
  loadBeatPrefs();
  $('beatStyle').value = S.beatStyle;
  $('beatLevel').value = S.beatLevel;
  $('beatFills').checked = S.beatFills;
  $('beatWithPlay').checked = S.beatWithPlay;
  $('warp').value = S.warp;
  $('tempo').value = S.tempo;
  showBeat(null);
  renderTempoInfo();
  renderAll();
})(window.SF = window.SF || {});
