// Drum beat, ported from Chord Stage: styles, synth drums and fills.
// The clock that plays it (shared with the sequencer) lives in app.js.
(function (SF) {
  'use strict';

  // 16 steps per bar. X = accent, x = hit, o = soft, g = ghost, . = rest.
  // k kick, s snare, c clap, r rim, h closed hat, o open hat, d ride, z shaker, b click
  // swing: how late the off-beats land (0.5 = straight); swingOn: 16 = 16th-note swing, 8 = 8th-note swing
  const BEATS = {
    neosoul: { name: 'Neo soul', bpm: '70–92', swing: 0.62, swingOn: 16,
      k: 'x......o..x.....', s: '....x..g....x..g', h: 'x.o.x.o.x.o.x.oo', r: '..........g.....' },
    boombap: { name: 'Boom bap', bpm: '84–96', swing: 0.58, swingOn: 16,
      k: 'x.....x...x..o..', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
    slowjam: { name: 'R&B slow jam (half-time)', bpm: '60–75', swing: 0.56, swingOn: 16,
      k: 'x.......x.o.....', s: '........X.......', c: '........x.......', h: 'x.ox.ox.x.ox.oxo' },
    trap: { name: 'Trap / modern R&B (half-time)', bpm: '60–80', swing: 0.5, swingOn: 16,
      k: 'x......x..x.....', c: '........X.......', h: 'x.x.x.xxx.x.xxxx', o: '..............o.' },
    pop: { name: 'Pop / straight', bpm: '90–130', swing: 0.5, swingOn: 16,
      k: 'x.......x.x.....', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.' },
    funk: { name: 'Funk', bpm: '95–115', swing: 0.53, swingOn: 16,
      k: 'x..x..x...x..x..', s: '....X..g.g..X..g', h: 'XoxoXoxoXoxoXoxo', o: '...........o....' },
    gospel: { name: 'Gospel shuffle', bpm: '70–100', swing: 0.66, swingOn: 8,
      k: 'x.....x.x.......', s: '....X.......X...', h: 'x.x.x.x.x.x.x.x.', c: '....x.......x...' },
    jazz: { name: 'Jazz swing (ride)', bpm: '100–180', swing: 0.66, swingOn: 8, fill: false,
      d: 'x...x.x.x...x.x.', h: '....x.......x...', k: 'g...g...g...g...' },
    bossa: { name: 'Bossa nova', bpm: '120–145', swing: 0.5, swingOn: 16, fill: false,
      k: 'x..xx..xx..xx..x', r: 'x..x..x...x..x..', z: 'xooxxooxxooxxoox' },
    click: { name: 'Click only (metronome)', bpm: 'any', swing: 0.5, swingOn: 16, fill: false, b: 'X...x...x...x...' },
    // 3/4 styles: 12 steps per bar
    slow34: { name: 'Slow 3/4 (soft ride + brush)', bpm: '60–80', steps: 12, swing: 0.5, swingOn: 16, fill: false,
      k: 'o...........', d: 'o...g...g...', z: '....g...g...' },
    jazzwaltz: { name: 'Jazz waltz 3/4', bpm: '110–170', steps: 12, swing: 0.66, swingOn: 8,
      d: 'x...x.x.x...', h: '....x...x...', k: 'o...........' },
    click34: { name: 'Click only 3/4', bpm: 'any', steps: 12, swing: 0.5, swingOn: 16, fill: false, b: 'X...x...x...' },
  };
  const stepsOf = function (st) { return st.steps || 16; };
  // A fill for the end of every 4th bar (last half bar in 4/4, last 6 steps in 3/4)
  const FILL = { k: 'x.......', s: 'x.g.x.xx', t: '....x.x.', l: '......xx' };
  const FILL3 = { k: 'x.....', s: 'g.x.xx', t: '....x.', l: '.....x' };
  const LEVEL = { X: 1, x: 0.8, o: 0.5, g: 0.22 };

  let ctx = null, bus = null, noiseBuf = null, openHat = null;

  // The drums get their own gain (Drums level) into the app's master.
  function drumBus(level) {
    ctx = SF.getContext();
    if (!bus) {
      bus = ctx.createGain();
      bus.connect(SF.master);
      const len = ctx.sampleRate, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = b;
    }
    bus.gain.setTargetAtTime(level * 0.9, ctx.currentTime, 0.02);
    return bus;
  }

  // Little synth helpers: an envelope, a noise burst, a pitched blip
  function env(t, v, attack, decay) {
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay); g.connect(bus); return g;
  }
  function noise(t, v, decay, type, freq, q, attack) {
    q = q == null ? 0.8 : q; attack = attack == null ? 0.001 : attack;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = env(t, v, attack, decay); src.connect(f); f.connect(g);
    src.start(t, Math.random() * 0.5); src.stop(t + attack + decay + 0.05); return src;
  }
  function blip(t, v, from, to, decay, type) {
    const o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
    o.connect(env(t, v, 0.002, decay)); o.start(t); o.stop(t + decay + 0.05);
  }
  const DRUM = {
    k: function (t, v) { blip(t, v * 1.1, 150, 42, 0.42); noise(t, v * 0.25, 0.012, 'lowpass', 3000); },
    s: function (t, v) { noise(t, v * 0.7, 0.17, 'bandpass', 1900, 0.7); blip(t, v * 0.45, 230, 170, 0.09, 'triangle'); },
    c: function (t, v) { [0, 0.011, 0.022].forEach(function (d) { noise(t + d, v * 0.55, d === 0.022 ? 0.16 : 0.01, 'bandpass', 1300, 1.2); }); },
    r: function (t, v) { blip(t, v * 0.5, 1700, 1600, 0.03, 'triangle'); noise(t, v * 0.25, 0.02, 'bandpass', 3500, 2); },
    h: function (t, v) {
      if (openHat) { try { openHat.stop(t); } catch (e) { /* done */ } openHat = null; }
      noise(t, v * 0.35, 0.045, 'highpass', 7500);
    },
    o: function (t, v) { openHat = noise(t, v * 0.32, 0.38, 'highpass', 7000); },
    d: function (t, v) { noise(t, v * 0.22, 0.7, 'bandpass', 6500, 0.6); blip(t, v * 0.05, 3200, 3100, 0.5, 'square'); },
    z: function (t, v) { noise(t, v * 0.22, 0.06, 'highpass', 5500, 0.7, 0.012); },
    b: function (t, v) { blip(t, v * 0.5, v > 0.9 ? 2000 : 1500, v > 0.9 ? 2000 : 1500, 0.035); },
    t: function (t, v) { blip(t, v * 0.8, 220, 150, 0.28); },
    l: function (t, v) { blip(t, v * 0.85, 150, 95, 0.32); },
    crash: function (t, v) { noise(t, v * 0.35, 1.3, 'highpass', 4500); },
  };

  // What plays on one step: [[instrument, level], ...]. Pure, so it can be tested.
  function hitsAt(style, step, bar, fills) {
    const st = BEATS[style] || BEATS.neosoul;
    const n = stepsOf(st), fill = n === 12 ? FILL3 : FILL, from = n - fill.k.length;
    const fillsOn = fills && st.fill !== false;
    const filling = fillsOn && bar % 4 === 3 && step >= from;
    const out = [];
    if (fillsOn && bar % 4 === 0 && bar > 0 && step === 0) out.push(['crash', 0.7]);
    for (const inst of Object.keys(DRUM)) {
      if (inst === 'crash') continue;
      const pat = filling ? (fill[inst] ? ' '.repeat(from) + fill[inst] : (inst === 'h' ? st.h : null)) : st[inst];
      const c = pat && pat[step];
      if (c && LEVEL[c]) out.push([inst, LEVEL[c]]);
    }
    return out;
  }

  // How late a swung step lands, in seconds (0 for steps on the grid).
  function swingOffset(style, step, bpm) {
    const st = BEATS[style] || BEATS.neosoul, d = 60 / bpm / 4;
    if (st.swingOn === 16 && step % 2 === 1) return (st.swing - 0.5) * 2 * d;
    if (st.swingOn === 8 && step % 4 === 2) return (st.swing - 0.5) * 4 * d;
    return 0;
  }

  function playStep(style, step, bar, t, fills) {
    if (!bus) return;
    hitsAt(style, step, bar, fills).forEach(function (h) { DRUM[h[0]](t, h[1]); });
  }

  function silence() {
    if (openHat) { try { openHat.stop(); } catch (e) { /* done */ } openHat = null; }
  }

  SF.Beat = {
    BEATS: BEATS,
    steps: function (style) { return stepsOf(BEATS[style] || BEATS.neosoul); },
    bus: drumBus,
    hitsAt: hitsAt,
    swingOffset: swingOffset,
    playStep: playStep,
    silence: silence,
  };
})(window.SF = window.SF || {});
