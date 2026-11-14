// Zoomable waveform with draggable chop markers and an overview strip.
(function (SF) {
  'use strict';

  const BLOCK = 256;
  const HIT_PX = 10;

  function Waveform(canvas, overview, cb) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.ov = overview;
    this.og = overview.getContext('2d');
    this.cb = cb;
    this.buffer = null;
    this.markers = [];
    this.view = { start: 0, end: 1 };
    this.selectedChop = -1;
    this.selectedMarker = -1;
    this.playhead = -1;
    this.markMode = false;
    this.selectMode = false;
    this.selection = null; // { a, b } in samples, a < b
    this.snap = function (s) { return s; };
    this.pointers = new Map();
    this.drag = null;
    this.colorFor = function () { return '#22e5ff'; };

    const self = this;
    canvas.addEventListener('pointerdown', function (e) { self.onDown(e); });
    canvas.addEventListener('pointermove', function (e) { self.onMove(e); });
    canvas.addEventListener('pointerup', function (e) { self.onUp(e); });
    canvas.addEventListener('pointercancel', function (e) { self.pointers.delete(e.pointerId); self.drag = null; });
    canvas.addEventListener('wheel', function (e) { self.onWheel(e); }, { passive: false });
    canvas.addEventListener('contextmenu', function (e) {
      const mi = self.markerAt(self.localX(e));
      if (mi >= 0) { e.preventDefault(); self.cb.onDeleteMarker(mi); }
    });
    const ovSeek = function (e) {
      if (!self.buffer || (e.type === 'pointermove' && !e.buttons)) return;
      const r = self.ov.getBoundingClientRect();
      const s = (e.clientX - r.left) / r.width * self.buffer.length;
      const len = self.view.end - self.view.start;
      self.setView(s - len / 2, s + len / 2);
    };
    overview.addEventListener('pointerdown', function (e) { overview.setPointerCapture(e.pointerId); ovSeek(e); });
    overview.addEventListener('pointermove', ovSeek);
    new ResizeObserver(function () { self.resize(); }).observe(canvas);
  }

  Waveform.prototype.setBuffer = function (buffer) {
    this.buffer = buffer;
    const x = SF.mono(buffer);
    const nb = Math.ceil(x.length / BLOCK);
    this.data = x;
    this.bmin = new Float32Array(nb);
    this.bmax = new Float32Array(nb);
    for (let b = 0; b < nb; b++) {
      let lo = 1, hi = -1;
      const end = Math.min(x.length, (b + 1) * BLOCK);
      for (let i = b * BLOCK; i < end; i++) {
        if (x[i] < lo) lo = x[i];
        if (x[i] > hi) hi = x[i];
      }
      this.bmin[b] = lo;
      this.bmax[b] = hi;
    }
    this.view = { start: 0, end: buffer.length };
    this.selection = null;
    this.ovCache = null;
    this.resize();
  };

  Waveform.prototype.resize = function () {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.ov]) {
      const r = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    }
    this.ovCache = null;
    this.draw();
  };

  Waveform.prototype.setView = function (start, end) {
    if (!this.buffer) return;
    const total = this.buffer.length;
    let len = Math.max(64, Math.min(total, end - start));
    start = Math.max(0, Math.min(total - len, start));
    this.view = { start: start, end: start + len };
    this.draw();
  };

  Waveform.prototype.zoom = function (factor, anchor, frac) {
    const len = this.view.end - this.view.start;
    if (anchor === undefined) { anchor = this.view.start + len / 2; frac = 0.5; }
    const nlen = len * factor;
    this.setView(anchor - frac * nlen, anchor - frac * nlen + nlen);
  };

  Waveform.prototype.localX = function (e) {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  };
  Waveform.prototype.width = function () {
    return this.canvas.getBoundingClientRect().width;
  };
  Waveform.prototype.xToSample = function (x) {
    return this.view.start + x / this.width() * (this.view.end - this.view.start);
  };
  Waveform.prototype.sampleToX = function (s) {
    return (s - this.view.start) / (this.view.end - this.view.start) * this.width();
  };

  Waveform.prototype.markerAt = function (x) {
    let best = -1, bestD = HIT_PX;
    for (let i = 0; i < this.markers.length; i++) {
      const d = Math.abs(this.sampleToX(this.markers[i]) - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  Waveform.prototype.edgeAt = function (x) {
    if (!this.selection) return null;
    const da = Math.abs(this.sampleToX(this.selection.a) - x);
    const db = Math.abs(this.sampleToX(this.selection.b) - x);
    if (Math.min(da, db) >= HIT_PX) return null;
    return da <= db ? 'a' : 'b';
  };

  Waveform.prototype.setSelection = function (a, b) {
    if (a === null || !this.buffer) {
      this.selection = null;
    } else {
      const total = this.buffer.length;
      a = Math.max(0, Math.min(total, Math.round(a)));
      b = Math.max(0, Math.min(total, Math.round(b)));
      this.selection = { a: Math.min(a, b), b: Math.max(a, b) };
    }
    this.draw();
    if (this.cb.onSelectionChange) this.cb.onSelectionChange(this.selection);
  };

  Waveform.prototype.chopAt = function (s) {
    for (let i = this.markers.length - 1; i >= 0; i--) if (s >= this.markers[i]) return i;
    return -1;
  };

  Waveform.prototype.onDown = function (e) {
    if (!this.buffer) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, e.clientX);
    if (this.pointers.size === 2) {
      const xs = Array.from(this.pointers.values());
      const r = this.canvas.getBoundingClientRect();
      const mid = (xs[0] + xs[1]) / 2 - r.left;
      this.drag = {
        type: 'pinch', d0: Math.abs(xs[0] - xs[1]) || 1, len0: this.view.end - this.view.start,
        anchor: this.xToSample(mid), frac: mid / r.width,
      };
      return;
    }
    const x = this.localX(e);
    // Selection edges grab first, then a new selection in Select mode or with Shift.
    const ei = this.edgeAt(x);
    if (ei) {
      this.drag = { type: 'select', fixed: ei === 'a' ? this.selection.b : this.selection.a };
      return;
    }
    if (this.selectMode || e.shiftKey) {
      this.drag = { type: 'selpending', x0: x, s0: this.snap(this.xToSample(x)) };
      return;
    }
    const mi = this.markerAt(x);
    if (mi >= 0) {
      this.selectedMarker = mi;
      this.drag = { type: 'marker', i: mi, moved: false };
      this.cb.onMarkerSelect(mi);
      this.draw();
    } else {
      this.drag = { type: 'pending', x0: x, start0: this.view.start };
    }
  };

  Waveform.prototype.onMove = function (e) {
    if (!this.drag && this.buffer) {
      const hx = this.localX(e);
      this.canvas.style.cursor = this.edgeAt(hx) ? 'ew-resize' : (this.selectMode ? 'crosshair' : '');
    }
    if (!this.drag || !this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, e.clientX);
    const d = this.drag;
    const x = this.localX(e);
    if (d.type === 'pinch') {
      const xs = Array.from(this.pointers.values());
      if (xs.length < 2) return;
      const len = d.len0 * d.d0 / (Math.abs(xs[0] - xs[1]) || 1);
      this.setView(d.anchor - d.frac * len, d.anchor - d.frac * len + len);
    } else if (d.type === 'marker') {
      const i = d.i;
      const minGap = 64;
      const lo = i > 0 ? this.markers[i - 1] + minGap : 0;
      const hi = i < this.markers.length - 1 ? this.markers[i + 1] - minGap : this.buffer.length - minGap;
      this.markers[i] = Math.round(Math.max(lo, Math.min(hi, this.xToSample(x))));
      d.moved = true;
      this.draw();
    } else if (d.type === 'selpending' || d.type === 'select') {
      if (d.type === 'selpending') {
        if (Math.abs(x - d.x0) <= 5) return;
        this.drag = { type: 'select', fixed: d.s0 };
      }
      this.setSelection(this.drag.fixed, this.snap(this.xToSample(x)));
    } else {
      if (d.type === 'pending' && Math.abs(x - d.x0) > 5) d.type = 'pan';
      if (d.type === 'pan') {
        const spp = (this.view.end - this.view.start) / this.width();
        const len = this.view.end - this.view.start;
        this.setView(d.start0 - (x - d.x0) * spp, d.start0 - (x - d.x0) * spp + len);
      }
    }
  };

  Waveform.prototype.onUp = function (e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.type === 'pinch') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    this.drag = null;
    if (d.type === 'selpending') {
      this.setSelection(null); // a click without a drag clears the selection
    } else if (d.type === 'select') {
      if (this.selection && this.selection.b - this.selection.a < 64) this.setSelection(null);
    } else if (d.type === 'marker' && d.moved) {
      this.cb.onMarkersChange();
    } else if (d.type === 'pending') {
      const s = this.xToSample(this.localX(e));
      if (this.markMode) this.cb.onAddMarker(Math.round(s));
      else this.cb.onChopClick(this.chopAt(s));
    }
  };

  Waveform.prototype.onWheel = function (e) {
    if (!this.buffer) return;
    e.preventDefault();
    const len = this.view.end - this.view.start;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const spp = len / this.width();
      this.setView(this.view.start + e.deltaX * spp, this.view.end + e.deltaX * spp);
    } else {
      const x = this.localX(e);
      const factor = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      this.zoom(factor, this.xToSample(x), x / this.width());
    }
  };

  Waveform.prototype.drawWave = function (g, w, h, start, end, color) {
    const spp = (end - start) / w;
    const mid = h / 2;
    g.fillStyle = color;
    g.beginPath();
    for (let px = 0; px < w; px++) {
      const s0 = start + px * spp;
      const s1 = s0 + spp;
      let lo = 1, hi = -1;
      if (spp >= BLOCK) {
        const b1 = Math.min(this.bmin.length, Math.ceil(s1 / BLOCK));
        for (let b = Math.floor(s0 / BLOCK); b < b1; b++) {
          if (this.bmin[b] < lo) lo = this.bmin[b];
          if (this.bmax[b] > hi) hi = this.bmax[b];
        }
      } else {
        const i1 = Math.min(this.data.length, Math.max(Math.floor(s0) + 1, Math.ceil(s1)));
        for (let i = Math.floor(s0); i < i1; i++) {
          const v = this.data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (hi < lo) continue;
      const y0 = mid - hi * mid * 0.95;
      const y1 = mid - lo * mid * 0.95;
      g.rect(px, y0, 1, Math.max(1, y1 - y0));
    }
    g.fill();
  };

  Waveform.prototype.draw = function () {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    g.clearRect(0, 0, W, H);
    if (!this.buffer) return;
    const total = this.buffer.length;
    const toX = (s) => (s - this.view.start) / (this.view.end - this.view.start) * W;

    // Chop regions.
    for (let i = 0; i < this.markers.length; i++) {
      const x0 = toX(this.markers[i]);
      const x1 = toX(i + 1 < this.markers.length ? this.markers[i + 1] : total);
      if (x1 < 0 || x0 > W) continue;
      g.fillStyle = this.colorFor(i);
      g.globalAlpha = i === this.selectedChop ? 0.22 : (i % 2 ? 0.05 : 0.09);
      g.fillRect(x0, 0, x1 - x0, H);
    }
    g.globalAlpha = 1;

    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(0, H / 2);
    g.lineTo(W, H / 2);
    g.stroke();

    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#5ef2ff');
    grad.addColorStop(0.5, '#22c8ff');
    grad.addColorStop(1, '#9b6bff');
    this.drawWave(g, W, H, this.view.start, this.view.end, grad);

    // Markers with pad labels.
    g.font = (10 * dpr) + 'px ui-monospace, Menlo, monospace';
    for (let i = 0; i < this.markers.length; i++) {
      const x = Math.round(toX(this.markers[i])) + 0.5;
      if (x < -20 || x > W + 20) continue;
      const sel = i === this.selectedMarker;
      g.strokeStyle = sel ? '#ffffff' : '#b57bff';
      g.lineWidth = sel ? 2 * dpr : 1 * dpr;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
      g.fillStyle = sel ? '#ffffff' : '#b57bff';
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 9 * dpr, 0);
      g.lineTo(x, 11 * dpr);
      g.fill();
      g.fillStyle = 'rgba(230,233,242,0.85)';
      g.fillText(String(i + 1), x + 4 * dpr, 22 * dpr);
    }
    g.lineWidth = 1;

    // Selection: dim everything outside it and outline its edges.
    if (this.selection) {
      const xa = toX(this.selection.a), xb = toX(this.selection.b);
      g.fillStyle = 'rgba(5,6,10,0.62)';
      if (xa > 0) g.fillRect(0, 0, Math.min(W, xa), H);
      if (xb < W) g.fillRect(Math.max(0, xb), 0, W - Math.max(0, xb), H);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(xa, 0, xb - xa, H);
      g.fillStyle = '#ffe066';
      for (const xe of [xa, xb]) {
        if (xe < -4 || xe > W + 4) continue;
        g.fillRect(Math.round(xe) - dpr, 0, 2 * dpr, H);
        g.fillRect(Math.round(xe) - 5 * dpr, H / 2 - 12 * dpr, 10 * dpr, 24 * dpr);
      }
    }

    if (this.playhead >= 0) {
      const x = toX(this.playhead);
      g.fillStyle = '#ffffff';
      g.fillRect(x, 0, 1.5 * dpr, H);
    }
    this.drawOverview();
  };

  Waveform.prototype.drawOverview = function () {
    const g = this.og;
    const W = this.ov.width, H = this.ov.height;
    if (!this.ovCache) {
      this.ovCache = document.createElement('canvas');
      this.ovCache.width = W;
      this.ovCache.height = H;
      this.drawWave(this.ovCache.getContext('2d'), W, H, 0, this.buffer.length, 'rgba(94,242,255,0.55)');
    }
    g.clearRect(0, 0, W, H);
    g.drawImage(this.ovCache, 0, 0);
    const total = this.buffer.length;
    g.fillStyle = 'rgba(181,123,255,0.7)';
    for (const m of this.markers) g.fillRect(Math.round(m / total * W), 0, 1, H);
    if (this.selection) {
      g.fillStyle = 'rgba(5,6,10,0.6)';
      g.fillRect(0, 0, this.selection.a / total * W, H);
      g.fillRect(this.selection.b / total * W, 0, W, H);
    }
    const x0 = this.view.start / total * W;
    const x1 = this.view.end / total * W;
    g.fillStyle = 'rgba(34,229,255,0.12)';
    g.fillRect(x0, 0, Math.max(2, x1 - x0), H);
    g.strokeStyle = 'rgba(34,229,255,0.8)';
    g.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0) - 1, H - 1);
    if (this.playhead >= 0) {
      g.fillStyle = '#fff';
      g.fillRect(this.playhead / total * W, 0, 1, H);
    }
  };

  SF.Waveform = Waveform;
})(window.SF = window.SF || {});
