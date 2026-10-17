// Arrangement generator: melody + chord symbols -> two-hand chord-based accompaniment.
import { parseChordSymbol, chordTonesOrdered, mod12, beatsPerMeasure, parseKey, QUALITY_BY_ID } from './theory.js';
import { chordAt } from './songformat.js';

export const STYLES = {
  pop: { name: 'Pop ballad', defaultPattern: 'broken', rhFill: 'strong', fillCount: 2 },
  ragtime: { name: 'Ragtime stride', defaultPattern: 'stride', rhFill: 'downbeat', fillCount: 1, octaveBass: true, octaveMelody: true },
  hymn: { name: 'Gospel / hymn', defaultPattern: 'block', rhFill: 'all', fillCount: 2, walkUps: 'fourths', blockEvery: 'half' },
  country: { name: 'Country', defaultPattern: 'stride', rhFill: 'strong', fillCount: 1, alternatingBass: true, walkUps: true },
};
export const LH_PATTERNS = { auto: 'Style default', block: 'Block chords', broken: 'Broken / arpeggio', stride: 'Stride / boom-chick' };

const EPS = 1e-6;
const r3 = (x) => Math.round(x * 1000) / 1000;
const BASS_LOW = 40, BASS_HIGH = 52;     // E2..E3
const CHORD_LOW = 48, CHORD_HIGH = 62;   // lowest note of LH chord in C3..B3, top <= ~E4
const RH_FLOOR = 55;                     // G3

function noteInRange(pc, low, high) {
  let n = low;
  while (mod12(n) !== mod12(pc)) n++;
  return n <= high ? n : n - 12;
}

/** Three-note close voicing chosen for smooth voice leading from `prev`. */
export function lhVoicing(parsed, prev) {
  let tones = [...new Set(chordTonesOrdered(parsed))];
  const q = QUALITY_BY_ID[parsed.quality];
  if (tones.length > 3) {
    // keep root, 3rd and the colour tone (7th/6th); drop the 5th and upper extensions
    const fifth = mod12(parsed.rootPc + 7);
    if (q.omit.includes(7)) tones = tones.filter((t) => t !== fifth);
    tones = tones.slice(0, 3);
  }
  const cands = [];
  for (let low = CHORD_LOW; low <= CHORD_LOW + 11; low++) {
    if (!tones.includes(mod12(low))) continue;
    const v = [low];
    for (const _ of tones.slice(1)) {
      let n = v[v.length - 1] + 1;
      while (!tones.includes(mod12(n)) || v.some((x) => mod12(x) === mod12(n))) n++;
      v.push(n);
    }
    if (v[v.length - 1] <= CHORD_HIGH + 2) cands.push(v);
  }
  const center = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : 54;
  const cost = (v) => prev
    ? v.reduce((a, n, i) => a + Math.abs(n - (prev[i] ?? prev[prev.length - 1])), 0)
    : Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center);
  cands.sort((a, b) => cost(a) - cost(b));
  return cands[0] || tones.map((t) => noteInRange(t, 52, 64)).sort((a, b) => a - b);
}

function scalePcs(key) {
  const k = parseKey(key);
  const steps = k.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return steps.map((s) => mod12(k.tonicPc + s));
}

/** Two approach notes walking up (or down) into `target` using the key's scale. */
function walkNotes(fromMidi, target, key) {
  const scale = scalePcs(key);
  const up = target >= fromMidi;
  const step = (n, dir) => { let m = n + dir; for (let i = 0; i < 3 && !scale.includes(mod12(m)); i++) m += dir; return m; };
  const a2 = step(target, up ? -1 : 1);
  const a1 = step(a2, up ? -1 : 1);
  return [a1, a2];
}

/** Rhythm pulses (relative to bar start) for each LH pattern given the bar length. */
function pulses(pattern, bpm, style) {
  if (pattern === 'block') {
    const every = style.blockEvery === 'half' ? (bpm === 4 ? 2 : bpm) : bpm;
    const out = [];
    for (let a = 0; a < bpm - EPS; a += every) out.push({ at: a, dur: every, kind: 'block' });
    return out;
  }
  if (pattern === 'broken') {
    const n = Math.round(bpm / 0.5);
    const seq4 = ['b', '5', '8', '10', '12', '10', '8', '5'];
    const seq3 = ['b', '5', '8', '10', '8', '5'];
    const seq = n === 6 ? seq3 : n === 4 ? ['b', '5', '8', '5'] : seq4;
    return Array.from({ length: n }, (_, i) => ({ at: i * 0.5, dur: 0.5, kind: 'arp', tone: seq[i % seq.length] }));
  }
  // stride / boom-chick
  if (bpm === 4) return [{ at: 0, dur: 1, kind: 'bass' }, { at: 1, dur: 1, kind: 'chord' }, { at: 2, dur: 1, kind: 'bass2' }, { at: 3, dur: 1, kind: 'chord' }];
  if (bpm === 3) return [{ at: 0, dur: 1, kind: 'bass' }, { at: 1, dur: 1, kind: 'chord' }, { at: 2, dur: 1, kind: 'chord' }];
  if (bpm === 2) return [{ at: 0, dur: 0.5, kind: 'bass' }, { at: 0.5, dur: 0.5, kind: 'chord' }, { at: 1, dur: 0.5, kind: 'bass2' }, { at: 1.5, dur: 0.5, kind: 'chord' }];
  if (Math.abs(bpm - 1.5 * Math.round(bpm / 1.5)) < EPS) { // compound meters (6/8 = 3 beats): bass on each dotted-quarter, chord after
    const out = [];
    for (let a = 0, i = 0; a < bpm - EPS; a += 1.5, i++) {
      out.push({ at: a, dur: 0.5, kind: i % 2 ? 'bass2' : 'bass' }, { at: a + 0.5, dur: 1, kind: 'chord' });
    }
    return out;
  }
  const out = [{ at: 0, dur: 1, kind: 'bass' }];
  for (let a = 1; a < bpm - EPS; a++) out.push({ at: a, dur: 1, kind: 'chord' });
  return out;
}

/**
 * Generate a full two-hand arrangement.
 * @param song normalized song (see songformat.normalizeSong)
 * @param opts {style:'pop'|'ragtime'|'hymn'|'country', lhPattern:'auto'|'block'|'broken'|'stride', rhFill:boolean}
 * @returns {style, lhPattern, leftHand:[{beat,dur,pitches}], rightHand:[{beat,dur,pitches}]}
 */
export function generateArrangement(song, opts = {}) {
  const styleId = STYLES[opts.style] ? opts.style : 'pop';
  const style = STYLES[styleId];
  const pattern = opts.lhPattern && opts.lhPattern !== 'auto' ? opts.lhPattern : style.defaultPattern;
  const rhFill = opts.rhFill !== false;
  const bpm = beatsPerMeasure(song.timeSignature);
  const pickup = song.pickupBeats || 0;
  const total = song.totalBeats;
  const left = [];
  let prevVoicing = null;

  // bars
  const bars = [];
  if (pickup > 0) bars.push([0, pickup, pickup - bpm]); // [start, end, virtualBarStart]
  for (let b = pickup; b < total - EPS; b += bpm) bars.push([b, Math.min(b + bpm, total), b]);

  // chord segments clipped to bars
  for (let bi = 0; bi < bars.length; bi++) {
    const [bs, be, vbs] = bars[bi];
    const segs = song.chords
      .filter((c) => c.beat < be - EPS && c.beat + c.dur > bs + EPS)
      .map((c) => ({ c, s: Math.max(c.beat, bs), e: Math.min(c.beat + c.dur, be) }));
    const barPulses = pulses(pattern, bpm, style);
    let alt = 0;
    for (let si = 0; si < segs.length; si++) {
      const { c, s, e } = segs[si];
      const parsed = parseChordSymbol(c.symbol);
      if (!parsed || parsed.nc) continue;
      const voicing = lhVoicing(parsed, prevVoicing);
      prevVoicing = voicing;
      const bass = noteInRange(parsed.bassPc, BASS_LOW, BASS_HIGH);
      const fifthBelow = (() => { const f = noteInRange(mod12(parsed.rootPc + 7), BASS_LOW - 7, BASS_HIGH); return f < bass ? f : f - 12 >= 33 ? f - 12 : f; })();
      // pulses inside this segment; ensure one at segment start
      let ps = barPulses.map((p) => ({ ...p, abs: r3(vbs + p.at) })).filter((p) => p.abs >= s - EPS && p.abs < e - EPS);
      if (!ps.length || ps[0].abs > s + EPS) {
        const kind = pattern === 'block' ? 'block' : pattern === 'broken' ? 'arp' : 'bass';
        ps.unshift({ at: s - vbs, abs: r3(s), dur: (ps[0]?.abs ?? e) - s, kind, tone: 'b' });
      }
      // a chord that starts on a "chord" pulse (mid-bar change in stride) should start with its bass
      if (ps[0].kind === 'chord') ps[0] = { ...ps[0], kind: 'bass' };

      // walk-up into next chord (country / gospel): on last beat(s) of the bar before a change
      const nextC = song.chords.find((x) => Math.abs(x.beat - e) < EPS);
      const nextParsed = nextC ? parseChordSymbol(nextC.symbol) : null;
      let walk = null;
      const rootMove = nextParsed && !nextParsed.nc ? mod12(nextParsed.bassPc - parsed.bassPc) : 0;
      const walkOk = style.walkUps === 'fourths' ? (rootMove === 5 || rootMove === 7) && bpm === 4 : !!style.walkUps && bpm >= 3;
      if (walkOk && Math.abs(e - be) < EPS && rootMove !== 0 && e - s >= bpm - EPS) {
        const target = noteInRange(nextParsed.bassPc, BASS_LOW, BASS_HIGH);
        walk = walkNotes(bass, target, song.key);
        if (bpm === 3) walk = [walk[1]]; // waltz: single approach note on beat 3
      }

      ps.forEach((p, i) => {
        const end = Math.min(e, ps[i + 1]?.abs ?? e, p.abs + (pattern === 'block' ? 99 : p.dur));
        const dur = r3(end - p.abs);
        if (dur <= EPS) return;
        let pitches;
        switch (p.kind) {
          case 'block':
            pitches = [bass, ...voicing];
            if (style.octaveBass && bass - 12 >= 28) pitches.unshift(bass - 12);
            break;
          case 'arp': {
            const third = parsed.pcs[1] ?? parsed.rootPc;
            const fifthPc = parsed.pcs[2] ?? mod12(parsed.rootPc + 7);
            const above = (pc, min) => { let n = min; while (mod12(n) !== pc) n++; return n; };
            const map = {
              b: bass,
              5: above(fifthPc, bass + 1),
              8: above(parsed.rootPc, bass + 7),
              10: above(third, above(parsed.rootPc, bass + 7) + 1),
              12: above(fifthPc, above(third, above(parsed.rootPc, bass + 7) + 1) + 1),
            };
            pitches = [map[p.tone] ?? bass];
            break;
          }
          case 'bass':
            pitches = style.octaveBass && bass - 12 >= 28 ? [bass - 12, bass] : [bass];
            break;
          case 'bass2': {
            const b2 = style.alternatingBass || styleId === 'ragtime' ? (parsed.bassPc !== parsed.rootPc ? noteInRange(parsed.rootPc, BASS_LOW, BASS_HIGH) : fifthBelow) : bass;
            pitches = style.octaveBass && b2 - 12 >= 28 ? [b2 - 12, b2] : [b2];
            alt++;
            break;
          }
          default:
            pitches = [...voicing];
        }
        left.push({ beat: p.abs, dur, pitches: [...new Set(pitches)].sort((a, b) => a - b), kind: p.kind });
      });

      if (walk) {
        // replace the content of the last 2 beats with: [bass-walk1 (+chord on top in block)], [walk2]
        const w1 = r3(e - walk.length), w2 = r3(e - 1);
        for (let i = left.length - 1; i >= 0 && left[i].beat >= s - EPS; i--) {
          const ev = left[i];
          if (ev.beat >= w1 - EPS) left.splice(i, 1);
          else if (ev.beat + ev.dur > w1 + EPS) ev.dur = r3(w1 - ev.beat);
        }
        walk.forEach((n, wi) => {
          const at = wi === walk.length - 1 ? w2 : w1;
          const withChord = pattern === 'block' && wi === 0;
          left.push({ beat: at, dur: 1, pitches: withChord ? [n, ...voicing].sort((a, b) => a - b) : [n], kind: 'walk' });
        });
      }
    }
  }
  left.sort((a, b) => a.beat - b.beat);

  // ----- right hand: melody + chord-tone fills -----
  const lhMaxAt = (beat) => {
    const ev = left.find((x) => x.beat <= beat + EPS && x.beat + x.dur > beat + EPS);
    return ev ? Math.max(...ev.pitches) : 0;
  };
  const right = song.melody.map((m) => {
    const top = Math.max(...m.pitches);
    const pitches = [...m.pitches];
    const ch = chordAt(song, m.beat);
    const parsed = ch ? parseChordSymbol(ch.symbol) : null;
    const posInBar = mod(m.beat - pickup, bpm);
    const isDownbeat = Math.abs(posInBar) < EPS;
    const isStrong = isDownbeat || (bpm === 4 && Math.abs(posInBar - 2) < EPS) || (ch && Math.abs(ch.beat - m.beat) < EPS);
    const want = !rhFill || !parsed || parsed.nc ? 0
      : style.rhFill === 'all' ? (m.dur >= 0.5 - EPS ? style.fillCount : 1)
      : style.rhFill === 'strong' ? (isStrong && m.dur >= 0.5 - EPS ? style.fillCount : 0)
      : style.rhFill === 'downbeat' ? (isDownbeat ? style.fillCount : 0) : 0;
    if (want && parsed.pcs.includes(mod12(top)) && m.pitches.length === 1) {
      const floor = Math.max(RH_FLOOR, lhMaxAt(m.beat) + 1);
      const cands = [];
      for (let n = top - 3; n >= Math.max(floor, top - 12) && cands.length < want; n--) {
        if (parsed.pcs.includes(mod12(n)) && mod12(n) !== mod12(top) && !cands.some((c) => mod12(c) === mod12(n))) cands.push(n);
      }
      pitches.push(...cands);
    }
    if (style.octaveMelody && rhFill && m.dur >= 1 - EPS && m.pitches.length === 1 && isDownbeat && top - 12 >= RH_FLOOR + 5 && top - 12 > lhMaxAt(m.beat)) {
      if (!pitches.includes(top - 12)) pitches.push(top - 12);
    }
    const ev = { beat: m.beat, dur: m.dur, pitches: [...new Set(pitches)].sort((a, b) => a - b) };
    if (m.lyric) ev.lyric = m.lyric;
    return ev;
  });

  return { style: styleId, lhPattern: pattern, leftHand: left.map(({ kind, ...e }) => e), rightHand: right };
}

function mod(a, n) { return ((a % n) + n) % n; }
