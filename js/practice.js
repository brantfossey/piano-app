// Play-along engines (pure logic, no DOM/audio): wait-for-me and steady-tempo scoring.
import { parseChordSymbol, mod12 } from './theory.js';

const EPS = 1e-6;

export const HAND_MODES = {
  right: 'Right hand',
  left: 'Left hand',
  both: 'Both hands',
  'melody+chords': 'Melody + chord symbols (LH any voicing)',
  chords: 'Chord symbols only (any voicing)',
};

/**
 * Build target items for a hand mode.
 * parts = {rightHand:[ev], leftHand:[ev], chords:[{beat,dur,symbol}]}
 * Returns {items, accompaniment}. items: {beat,dur,hand:'R'|'L'|'C', exact:[midi], pcs?, symbol?}
 * accompaniment: events NOT being practiced (can be auto-played).
 */
export function buildTargets(parts, hands, { fromBeat = 0, toBeat = Infinity } = {}) {
  const inRange = (e) => e.beat >= fromBeat - EPS && e.beat < toBeat - EPS;
  const R = (parts.rightHand || []).filter(inRange).map((e) => ({ beat: e.beat, dur: e.dur, hand: 'R', exact: [...e.pitches] }));
  const L = (parts.leftHand || []).filter(inRange).map((e) => ({ beat: e.beat, dur: e.dur, hand: 'L', exact: [...e.pitches] }));
  const C = (parts.chords || []).filter(inRange).map((c) => {
    const p = parseChordSymbol(c.symbol);
    return p && !p.nc ? { beat: c.beat, dur: c.dur, hand: 'C', exact: [], pcs: p.pcs, symbol: c.symbol, quality: p.quality, rootPc: p.rootPc } : null;
  }).filter(Boolean);
  let items, accompaniment;
  switch (hands) {
    case 'right': items = R; accompaniment = L; break;
    case 'left': items = L; accompaniment = R; break;
    case 'both': items = [...R, ...L]; accompaniment = []; break;
    case 'chords': items = C; accompaniment = R; break;
    case 'melody+chords': default: items = [...R, ...C]; accompaniment = []; break;
  }
  items.sort((a, b) => a.beat - b.beat || (a.hand < b.hand ? -1 : 1));
  return { items, accompaniment: accompaniment.map((a) => ({ beat: a.beat, dur: a.dur, pitches: a.exact })) };
}

/** Group items into steps by onset. */
export function buildSteps(items) {
  const steps = [];
  for (const it of items) {
    let s = steps[steps.length - 1];
    if (!s || Math.abs(s.beat - it.beat) > EPS) { s = { beat: it.beat, exact: [], chordReqs: [], items: [] }; steps.push(s); }
    s.items.push(it);
    for (const n of it.exact) if (!s.exact.includes(n)) s.exact.push(n);
    if (it.pcs) s.chordReqs.push({ pcs: it.pcs, symbol: it.symbol, quality: it.quality, rootPc: it.rootPc });
  }
  return steps;
}

/** Required pcs of a chord requirement (optionally allowing the 5th to be omitted). */
function requiredPcs(req, allowOmitFifth) {
  if (!allowOmitFifth || req.pcs.length < 4 || req.rootPc == null) return req.pcs;
  const fifth = mod12(req.rootPc + 7);
  return req.pcs.filter((p) => p !== fifth);
}

export function chordSatisfied(req, notes, allowOmitFifth = true) {
  const have = new Set(notes.map(mod12));
  const need = requiredPcs(req, allowOmitFifth);
  return need.every((p) => have.has(p)) && [...have].every((p) => req.pcs.includes(p));
}

/** Wait-for-me: advances only when the current step's notes/chord are played. */
export class WaitEngine {
  constructor(steps, { graceSec = 0.3, allowOmitFifth = true, onEvent = () => {} } = {}) {
    this.steps = steps;
    this.index = 0;
    this.graceSec = graceSec;
    this.allowOmitFifth = allowOmitFifth;
    this.onEvent = onEvent;
    this.held = new Map(); // note -> press time
    this.fresh = new Set(); // notes pressed since the current step became active
    this.wrong = 0; this.correctSteps = 0; this.stepWrong = 0;
    this.startTime = null; this.stepStart = null; this.stepTimes = [];
  }
  get current() { return this.steps[this.index] || null; }
  get done() { return this.index >= this.steps.length; }
  start(t) { this.startTime = t; this.stepStart = t; this.onEvent({ type: 'step', index: 0, step: this.current }); }

  isUseful(note, step = this.current) {
    if (!step) return false;
    if (step.exact.includes(note)) return true;
    return step.chordReqs.some((r) => r.pcs.includes(mod12(note)));
  }
  noteOn(note, t) {
    if (this.startTime == null) this.start(t);
    this.held.set(note, t);
    this.fresh.add(note);
    if (this.done) return;
    if (!this.isUseful(note)) { this.wrong++; this.stepWrong++; this.onEvent({ type: 'wrong', note, index: this.index }); }
    this.check(t);
  }
  noteOff(note) { this.held.delete(note); this.fresh.delete(note); }

  /** Notes that count for the current step. */
  active() { return [...this.fresh].filter((n) => this.held.has(n)); }

  check(t) {
    const step = this.current;
    if (!step) return false;
    const act = this.active();
    const exactOk = step.exact.every((n) => act.includes(n));
    const others = act.filter((n) => !step.exact.includes(n));
    const chordOk = step.chordReqs.every((r) => chordSatisfied(r, others.length ? others : act, this.allowOmitFifth));
    if (exactOk && chordOk) {
      this.stepTimes.push(t - this.stepStart);
      if (this.stepWrong === 0) this.correctSteps++;
      const used = new Set(act);
      this.index++;
      this.stepWrong = 0;
      this.stepStart = t;
      // keep notes pressed just now that were NOT part of the finished step (early press for next step)
      this.fresh = new Set([...this.held.entries()].filter(([n, pt]) => !used.has(n) && t - pt <= this.graceSec).map(([n]) => n));
      this.onEvent({ type: 'advance', index: this.index, step: this.current, done: this.done });
      if (this.done) this.onEvent({ type: 'finished', results: this.results() });
      else if (this.fresh.size) this.check(t);
      return true;
    }
    return false;
  }
  results() {
    const total = this.steps.length;
    const avg = this.stepTimes.length ? this.stepTimes.reduce((a, b) => a + b, 0) / this.stepTimes.length : 0;
    return {
      mode: 'wait', total, completed: Math.min(this.index, total), cleanSteps: this.correctSteps, wrongNotes: this.wrong,
      accuracy: total ? Math.round((100 * this.correctSteps) / total) : 0, avgStepSec: Math.round(avg * 100) / 100,
    };
  }
}

/** Steady tempo with timing/accuracy scoring. Times are seconds on one clock. */
export class SteadyEngine {
  constructor(items, { tempo = 90, startTime = 0, windowSec = null, allowOmitFifth = true, onEvent = () => {} } = {}) {
    this.tempo = tempo;
    this.spb = 60 / tempo;
    this.startTime = startTime; // time of beat 0 of `items` timeline
    this.window = windowSec ?? Math.min(0.25, 0.45 * this.spb);
    this.allowOmitFifth = allowOmitFifth;
    this.onEvent = onEvent;
    this.expected = [];
    for (const it of items) {
      const time = startTime + it.beat * this.spb;
      for (const n of it.exact) this.expected.push({ kind: 'note', time, beat: it.beat, midi: n, hand: it.hand, matched: false, missed: false });
      if (it.pcs) this.expected.push({ kind: 'chord', time, beat: it.beat, pcs: it.pcs, rootPc: it.rootPc, quality: it.quality, symbol: it.symbol, hit: new Map(), matched: false, missed: false });
    }
    this.extra = 0;
    this.matches = []; // {offset, grade}
  }
  beatAt(t) { return (t - this.startTime) / this.spb; }
  grade(off) { const a = Math.abs(off); return a <= 0.06 ? 'perfect' : a <= 0.12 ? 'good' : 'ok'; }

  noteOn(note, t) {
    let best = null;
    for (const e of this.expected) {
      if (e.kind !== 'note' || e.matched || e.missed || e.midi !== note) continue;
      const d = Math.abs(t - e.time);
      if (d <= this.window && (!best || d < Math.abs(t - best.time))) best = e;
    }
    if (best) {
      best.matched = true;
      const off = t - best.time;
      const g = this.grade(off);
      this.matches.push({ offset: off, grade: g });
      this.onEvent({ type: 'hit', item: best, offset: off, grade: g });
      return;
    }
    const cw = this.window * 1.6;
    for (const e of this.expected) {
      if (e.kind !== 'chord' || e.matched || e.missed || !e.pcs.includes(mod12(note))) continue;
      if (Math.abs(t - e.time) > cw) continue;
      if (!e.hit.has(mod12(note))) e.hit.set(mod12(note), t);
      const req = { pcs: e.pcs, rootPc: e.rootPc, quality: e.quality };
      if (chordSatisfied(req, [...e.hit.keys()], this.allowOmitFifth)) {
        e.matched = true;
        const first = Math.min(...e.hit.values());
        const off = first - e.time;
        const g = this.grade(off);
        this.matches.push({ offset: off, grade: g });
        this.onEvent({ type: 'hit', item: e, offset: off, grade: g });
      }
      return;
    }
    this.extra++;
    this.onEvent({ type: 'extra', note, time: t });
  }
  noteOff() {}
  update(t) {
    for (const e of this.expected) {
      if (!e.matched && !e.missed && t > e.time + (e.kind === 'chord' ? this.window * 1.6 : this.window)) {
        e.missed = true;
        this.onEvent({ type: 'miss', item: e });
      }
    }
    const end = this.expected.length ? Math.max(...this.expected.map((e) => e.time)) + this.window * 1.6 : this.startTime;
    if (t > end && !this.finished) { this.finished = true; this.onEvent({ type: 'finished', results: this.results() }); }
  }
  results() {
    const total = this.expected.length;
    const counts = { perfect: 0, good: 0, ok: 0 };
    this.matches.forEach((m) => counts[m.grade]++);
    const hit = this.matches.length;
    const w = counts.perfect + counts.good * 0.85 + counts.ok * 0.6;
    const offs = this.matches.map((m) => m.offset);
    const mean = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
    const meanAbs = offs.length ? offs.reduce((a, b) => a + Math.abs(b), 0) / offs.length : 0;
    return {
      mode: 'steady', total, hit, missed: this.expected.filter((e) => e.missed).length, extra: this.extra, ...counts,
      accuracy: total ? Math.round((100 * hit) / total) : 0,
      score: total ? Math.round((100 * w) / (total + 0.5 * this.extra)) : 0,
      meanOffsetMs: Math.round(mean * 1000), meanAbsOffsetMs: Math.round(meanAbs * 1000),
      tendency: Math.abs(mean) < 0.02 ? 'on time' : mean < 0 ? 'rushing (early)' : 'dragging (late)',
    };
  }
}
