// Grand-staff renderer (SVG). Proportional spacing (x ∝ beat), noteheads/stems/flags/dots,
// accidentals with key signature, ledger lines, chord symbols and lyrics. Not engraving quality,
// but readable and fast enough to redraw live.
import { spellMidi, staffStep, parseKey, beatsPerMeasure, parseTimeSignature } from './theory.js';

const NS = 'http://www.w3.org/2000/svg';
const S = 9; // staff line spacing (px)
const EPS = 1e-6;
const SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34];
const FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31];

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

export class ScoreView {
  constructor(container, { compact = false, measuresPerRow = null, onBeatClick = null } = {}) {
    this.container = container; this.compact = compact; this.fixedMpr = measuresPerRow; this.onBeatClick = onBeatClick;
    this.model = null; this.groups = new Map(); this.rows = [];
    if (!compact && typeof ResizeObserver !== 'undefined') {
      let w = 0;
      new ResizeObserver(() => { const nw = container.clientWidth; if (this.model && Math.abs(nw - w) > 30) { w = nw; this.render(this.model); } }).observe(container);
    }
  }

  /** model: {key,timeSignature,pickupBeats,totalBeats,rh:[{beat,dur,pitches,lyric?}],lh:[...],chords:[{beat,symbol}],
   *  chordLabel?(symbol)->{main,sub}, noteClass?(midi)->'played target …' (same state classes as the on-screen keys)} */
  render(model) {
    this.model = model;
    const key = parseKey(model.key || 'C');
    const bpm = beatsPerMeasure(model.timeSignature || '4/4');
    const pickup = model.pickupBeats || 0;
    const total = Math.max(model.totalBeats || bpm, pickup + bpm * (this.compact ? 0 : 1));
    const W = this.compact ? 280 : Math.max(320, this.container.clientWidth || 900); // compact: fixed viewBox, scaled by CSS
    const measures = [];
    if (pickup > 0) measures.push({ start: 0, len: pickup });
    for (let b = pickup; b < total - EPS; b += bpm) measures.push({ start: b, len: bpm });
    if (!measures.length) measures.push({ start: 0, len: bpm });
    const mpr = this.fixedMpr || Math.max(1, Math.min(6, Math.floor((W - 90) / (bpm * 52))));
    const rows = [];
    for (let i = 0; i < measures.length;) {
      const take = i === 0 && pickup > 0 ? mpr + 1 : mpr;
      rows.push(measures.slice(i, i + take)); i += take;
    }
    const keyCount = Math.abs(key.fifths);
    const rowH = this.compact ? 15 * S + 20 : 20 * S + (model.showLyrics ? 14 : 0);
    const H = rows.length * rowH + 10;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'score' });
    this.groups = new Map(); this.rows = [];
    const accState = new Map();

    rows.forEach((row, ri) => {
      const y0 = ri * rowH + (this.compact ? 4 : 18);
      const tTop = y0 + 3 * S, bTop = tTop + 4 * S + 6 * S;
      const rs = row[0].start, re = row[row.length - 1].start + row[row.length - 1].len;
      const header = 34 + keyCount * 9 + (ri === 0 && !this.compact ? 22 : 0) + 8;
      const x0 = header + 6, x1 = W - 8;
      const ppb = (x1 - x0 - 14) / Math.max(EPS, re - rs);
      const X = (b) => x0 + 14 + (b - rs) * ppb;
      this.rows.push({ rs, re, X, y0, tTop, bTop, h: rowH });
      const g = el('g', {}, svg);
      // staff lines
      for (const top of [tTop, bTop]) for (let i = 0; i < 5; i++) el('line', { x1: 6, x2: x1, y1: top + i * S, y2: top + i * S, class: 'staffline' }, g);
      el('line', { x1: 6, x2: 6, y1: tTop, y2: bTop + 4 * S, class: 'barline' }, g);
      el('path', { d: `M4 ${tTop} q-6 ${(bTop + 4 * S - tTop) / 2} 0 ${bTop + 4 * S - tTop}`, class: 'brace' }, g);
      // clefs
      el('text', { x: 9, y: tTop + 3.3 * S, class: 'clef', 'font-size': 4.6 * S }, g).textContent = '𝄞';
      el('text', { x: 10, y: bTop + 2.6 * S, class: 'clef', 'font-size': 3.2 * S }, g).textContent = '𝄢';
      // key signature
      const ks = key.fifths > 0 ? SHARP_STEPS : FLAT_STEPS;
      for (let i = 0; i < keyCount; i++) {
        const st = ks[i];
        const glyph = key.fifths > 0 ? '♯' : '♭';
        el('text', { x: 34 + i * 9, y: tY(tTop, st) + 4, class: 'acc ks' }, g).textContent = glyph;
        el('text', { x: 34 + i * 9, y: bY(bTop, st - 14) + 4, class: 'acc ks' }, g).textContent = glyph;
      }
      if (ri === 0 && !this.compact) {
        const ts = parseTimeSignature(model.timeSignature || '4/4');
        const tx = 36 + keyCount * 9 + 4;
        for (const top of [tTop, bTop]) {
          el('text', { x: tx, y: top + 1.9 * S, class: 'timesig' }, g).textContent = ts.num;
          el('text', { x: tx, y: top + 3.9 * S, class: 'timesig' }, g).textContent = ts.den;
        }
      }
      // bar lines + measure numbers
      if (!this.compact) {
        row.forEach((m, mi) => {
          const bx = mi === 0 ? x0 : X(m.start) - 8;
          if (mi > 0) el('line', { x1: bx, x2: bx, y1: tTop, y2: bTop + 4 * S, class: 'barline' }, g);
          const num = pickup > 0 ? measures.indexOf(m) : measures.indexOf(m) + 1;
          if (num > 0 && (mi === 0 || num % 1 === 0)) el('text', { x: bx + 2, y: tTop - 4, class: 'mnum' }, g).textContent = num;
        });
        el('line', { x1: x1, x2: x1, y1: tTop, y2: bTop + 4 * S, class: 'barline' + (ri === rows.length - 1 ? ' final' : '') }, g);
      }
      // click to set start position
      if (this.onBeatClick) {
        const hit = el('rect', { x: x0, y: y0, width: x1 - x0, height: rowH - 10, class: 'hitarea' }, g);
        hit.addEventListener('click', (e) => {
          const pt = svg.getBoundingClientRect();
          const sx = (e.clientX - pt.left) * (W / pt.width);
          this.onBeatClick(Math.max(rs, Math.min(re, rs + (sx - x0 - 14) / ppb)));
        });
      }
      // chord symbols
      for (const c of model.chords || []) {
        if (c.beat < rs - EPS || c.beat >= re - EPS) continue;
        const lab = model.chordLabel ? model.chordLabel(c.symbol) : { main: c.symbol, sub: '' };
        const t = el('text', { x: X(c.beat) - 5, y: tTop - 1.6 * S, class: 'chordsym' }, g);
        t.textContent = lab.main;
        if (lab.sub) { const sub = el('tspan', { class: 'chordsub', dx: 2 }, t); sub.textContent = lab.sub.replace(' inversion', ' inv.'); }
      }
      const measureOf = (b) => measures.findIndex((m) => b >= m.start - EPS && b < m.start + m.len - EPS);
      const drawHand = (events, hand) => {
        // group by onset
        const byBeat = new Map();
        for (const e of events || []) {
          if (e.beat < rs - EPS || e.beat >= re - EPS) continue;
          const k = Math.round(e.beat * 1000);
          if (!byBeat.has(k)) byBeat.set(k, { beat: e.beat, dur: e.dur, pitches: [], lyric: e.lyric });
          byBeat.get(k).pitches.push(...e.pitches);
        }
        for (const grp of byBeat.values()) {
          const gEl = drawGroup(g, grp, hand, X(grp.beat), hand === 'L' ? 'bass' : 'treble', tTop, bTop, key, accState, measureOf(grp.beat), !!this.compact, model.noteClass);
          if (grp.lyric && model.showLyrics) el('text', { x: X(grp.beat), y: tTop + 4 * S + 3.4 * S, class: 'lyric' }, g).textContent = grp.lyric;
          const k = hand + '@' + Math.round(grp.beat * 1000);
          this.groups.set(k, gEl);
        }
      };
      drawHand(model.rh, 'R');
      drawHand(model.lh, 'L');
    });
    this.cursor = el('rect', { x: -10, y: 0, width: 3, height: rowH - 12, class: 'cursor' }, svg);
    this.startMark = el('rect', { x: -10, y: 0, width: 2, height: rowH - 12, class: 'startmark' }, svg);
    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.svg = svg;
  }

  rowFor(beat) { return this.rows.find((r) => beat >= r.rs - EPS && beat < r.re - EPS) || this.rows[this.rows.length - 1]; }
  setCursor(beat, scroll = true) {
    if (!this.cursor || beat == null) { if (this.cursor) this.cursor.setAttribute('x', -10); return; }
    const r = this.rowFor(beat); if (!r) return;
    this.cursor.setAttribute('x', r.X(beat) - 7);
    this.cursor.setAttribute('y', r.y0);
    if (scroll && this.container.scrollHeight > this.container.clientHeight) {
      const top = r.y0 - 10, bottom = r.y0 + r.h;
      const c = this.container;
      if (top < c.scrollTop || bottom > c.scrollTop + c.clientHeight) c.scrollTo({ top: Math.max(0, top - 10), behavior: 'smooth' });
    }
  }
  setStartMark(beat) {
    if (!this.startMark) return;
    if (!beat) { this.startMark.setAttribute('x', -10); return; }
    const r = this.rowFor(beat); this.startMark.setAttribute('x', r.X(beat) - 9); this.startMark.setAttribute('y', r.y0);
  }
  mark(beat, hand, cls) {
    const hands = hand ? [hand] : ['R', 'L'];
    for (const h of hands) { const g = this.groups.get(h + '@' + Math.round(beat * 1000)); if (g) g.classList.add(cls); }
  }
  clearMarks() { for (const g of this.groups.values()) g.classList.remove('current', 'hit', 'miss', 'late', 'early'); }
}

const tY = (tTop, step) => tTop + ((38 - step) * S) / 2;
const bY = (bTop, step) => bTop + ((26 - step) * S) / 2;

function drawGroup(parent, grp, hand, x, staff, tTop, bTop, key, accState, measureIdx, compact, noteClass) {
  const g = el('g', { class: 'notegroup hand-' + hand }, parent);
  const notes = [...new Set(grp.pitches)].sort((a, b) => a - b).map((m) => {
    const sp = spellMidi(m, key);
    return { midi: m, sp, step: staffStep(sp) };
  });
  const Y = staff === 'treble' ? (st) => tY(tTop, st) : (st) => bY(bTop, st);
  const mid = staff === 'treble' ? 34 : 22;
  const dur = grp.dur;
  const hollow = dur >= 2 - EPS;
  const stemless = dur >= 4 - EPS || compact;
  const avg = notes.reduce((a, n) => a + n.step, 0) / notes.length;
  const up = avg < mid;
  // ledger lines
  const lo = notes[0].step, hi = notes[notes.length - 1].step;
  const [bottomLine, topLine] = staff === 'treble' ? [30, 38] : [18, 26];
  for (let st = bottomLine - 2; st >= lo; st -= 2) el('line', { x1: x - 8, x2: x + 8, y1: Y(st), y2: Y(st), class: 'ledger' }, g);
  for (let st = topLine + 2; st <= hi; st += 2) el('line', { x1: x - 8, x2: x + 8, y1: Y(st), y2: Y(st), class: 'ledger' }, g);
  // accidentals (per measure, per staff position)
  let accCol = 0;
  const sig = keyMap(key.fifths);
  notes.forEach((n) => {
    const k = `${measureIdx}|${staff}|${n.sp.letter}${n.sp.octave}`;
    const current = accState.has(k) ? accState.get(k) : sig[n.sp.letter];
    if (n.sp.acc !== current || compact && n.sp.acc !== sig[n.sp.letter]) {
      const glyph = { 1: '♯', 2: '𝄪', '-1': '♭', '-2': '𝄫', 0: '♮' }[n.sp.acc];
      el('text', { x: x - 15 - (accCol % 2) * 8, y: Y(n.step) + 4, class: 'acc' }, g).textContent = glyph;
      accCol++;
      if (!compact) accState.set(k, n.sp.acc);
    }
  });
  // heads (seconds displaced)
  let prevStep = -99, prevShift = false;
  const heads = notes.map((n) => {
    const shift = n.step - prevStep === 1 && !prevShift;
    prevShift = shift; prevStep = n.step;
    const hx = x + (shift ? (up ? 9 : -9) : 0);
    el('ellipse', { cx: hx, cy: Y(n.step), rx: 5.2, ry: 3.8, transform: `rotate(-20 ${hx} ${Y(n.step)})`, class: 'head' + (hollow ? ' hollow' : '') + (noteClass ? ' ' + noteClass(n.midi) : ''), 'data-midi': n.midi }, g);
    // dots
    if ([0.75, 1.5, 3, 6].some((d) => Math.abs(d - dur) < EPS)) {
      const dy = n.step % 2 === (staff === 'treble' ? 0 : 0) ? -S / 2 : 0;
      el('circle', { cx: x + 10 + (shift ? 9 : 0), cy: Y(n.step) + (((staff === 'treble' ? 38 : 26) - n.step) % 2 === 0 ? -S / 2 : 0) + 0 * dy, r: 1.6, class: 'dot' }, g);
    }
    return hx;
  });
  if (!stemless) {
    const yLo = Y(lo), yHi = Y(hi);
    const len = 3.4 * S;
    let sx, y1, y2;
    if (up) { sx = x + 4.8; y1 = yLo; y2 = yHi - len; } else { sx = x - 4.8; y1 = yHi; y2 = yLo + len; }
    el('line', { x1: sx, x2: sx, y1, y2, class: 'stem' }, g);
    const flags = dur <= 0.375 + EPS ? 2 : dur <= 0.75 + EPS ? 1 : 0;
    for (let f = 0; f < flags; f++) {
      const fy = y2 + (up ? f * 7 : -f * 7);
      el('path', { d: up ? `M${sx} ${fy} q2 6 8 10 q-4 -3 -8 -5` : `M${sx} ${fy} q2 -6 8 -10 q-4 3 -8 5`, class: 'flag' }, g);
    }
  }
  return g;
}

function keyMap(fifths) {
  const m = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) ['F', 'C', 'G', 'D', 'A', 'E', 'B'].slice(0, fifths).forEach((l) => (m[l] = 1));
  if (fifths < 0) ['B', 'E', 'A', 'D', 'G', 'C', 'F'].slice(0, -fifths).forEach((l) => (m[l] = -1));
  return m;
}
