// Music theory core: pitch parsing/spelling, chord symbols, chord detection, inversions.
// Pure functions, no DOM — usable from the browser and from Node tests.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC_VAL = { '': 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2, '♯': 1, '♭': -1 };
export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// Common root spellings for chord names when no key context is given.
export const ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const mod12 = (n) => ((n % 12) + 12) % 12;

/** Parse "C4", "F#3", "Bb5", "c#4", or a MIDI number. Returns MIDI number or null. Middle C = C4 = 60. */
export function parsePitch(p) {
  if (typeof p === 'number') return Number.isInteger(p) && p >= 0 && p <= 127 ? p : null;
  if (typeof p !== 'string') return null;
  const m = /^\s*([A-Ga-g])(##|#|x|bb|b|♯|♭)?(-?\d)\s*$/.exec(p);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const midi = (parseInt(m[3], 10) + 1) * 12 + LETTER_PC[letter] + ACC_VAL[m[2] || ''];
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** Parse a pitch string into its written spelling {letter, acc, octave, midi}. */
export function parseSpelling(p) {
  const m = /^\s*([A-Ga-g])(##|#|x|bb|b|♯|♭)?(-?\d)\s*$/.exec(p);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const acc = ACC_VAL[m[2] || ''];
  const octave = parseInt(m[3], 10);
  return { letter, acc, octave, midi: (octave + 1) * 12 + LETTER_PC[letter] + acc };
}

export function parsePitchClass(name) {
  const m = /^\s*([A-Ga-g])(##|#|x|bb|b|♯|♭)?\s*$/.exec(name || '');
  if (!m) return null;
  return mod12(LETTER_PC[m[1].toUpperCase()] + ACC_VAL[m[2] || '']);
}

// ---------- Keys ----------
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Parse a key like "G", "Eb", "F#m", "Am", "D minor". Returns {tonic, minor, fifths, tonicPc, name}. */
export function parseKey(key) {
  const m = /^\s*([A-Ga-g])(#|b)?\s*(m|min|minor|major|maj|M)?\s*$/.exec(key || 'C');
  if (!m) return parseKey('C');
  const tonic = m[1].toUpperCase() + (m[2] || '');
  const minor = !!m[3] && /^m(in(or)?)?$/.test(m[3]);
  const tonicPc = parsePitchClass(tonic);
  let fifths;
  if (minor) {
    const relPc = mod12(tonicPc + 3);
    // choose relative major spelling consistent with tonic accidental
    const cands = Object.entries(MAJOR_FIFTHS).filter(([k]) => parsePitchClass(k) === relPc);
    const pick = cands.find(([k]) => (m[2] === 'b' ? k.includes('b') || k.length === 1 : !k.includes('b'))) || cands[0];
    fifths = pick[1];
  } else {
    fifths = MAJOR_FIFTHS[tonic] ?? (tonic.includes('#') ? 7 : -7);
  }
  return { tonic, minor, fifths, tonicPc, name: tonic + (minor ? 'm' : '') };
}

/** Map letter -> accidental (+1/-1/0) for a key signature. */
export function keySignatureMap(fifths) {
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => (map[l] = 1));
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach((l) => (map[l] = -1));
  return map;
}

/** Spell a MIDI note in a key context. Returns {letter, acc, octave, name}. */
export function spellMidi(midi, key = 'C') {
  const k = typeof key === 'object' ? key : parseKey(key);
  const sig = keySignatureMap(k.fifths);
  const pc = mod12(midi);
  // 1) diatonic note of the key
  for (const L of LETTERS) {
    if (mod12(LETTER_PC[L] + sig[L]) === pc) return mk(L, sig[L]);
  }
  // 2) minor-key leading tone / raised 6th: prefer raising scale degree
  if (k.minor) {
    for (const deg of [6, 5]) {
      const L = LETTERS[(LETTERS.indexOf(k.tonic[0]) + deg) % 7];
      if (mod12(LETTER_PC[L] + sig[L] + 1) === pc) return mk(L, sig[L] + 1);
    }
  }
  // 3) natural form of a letter that the key signature alters (e.g. F natural in G major)
  for (const L of LETTERS) {
    if (sig[L] !== 0 && LETTER_PC[L] === pc) return mk(L, 0);
  }
  // 4) chromatic: sharps in sharp keys, flats in flat keys
  const preferSharp = k.fifths >= 0;
  for (const L of LETTERS) {
    const a = sig[L] + (preferSharp ? 1 : -1);
    if (mod12(LETTER_PC[L] + a) === pc) return mk(L, a);
  }
  for (const L of LETTERS) {
    const a = sig[L] + (preferSharp ? -1 : 1);
    if (mod12(LETTER_PC[L] + a) === pc) return mk(L, a);
  }
  return mk(SHARP_NAMES[pc][0], SHARP_NAMES[pc].length > 1 ? 1 : 0);

  function mk(letter, acc) {
    const octave = Math.floor((midi - LETTER_PC[letter] - acc) / 12) - 1;
    const accStr = acc === 1 ? '#' : acc === 2 ? '##' : acc === -1 ? 'b' : acc === -2 ? 'bb' : '';
    return { letter, acc, octave, name: letter + accStr + octave };
  }
}

export function midiToName(midi, key) {
  if (key) return spellMidi(midi, key).name;
  return SHARP_NAMES[mod12(midi)] + (Math.floor(midi / 12) - 1);
}

/** Diatonic staff step: C4 = 28, D4 = 29 ... (7 per octave). */
export function staffStep(spelling) {
  return LETTERS.indexOf(spelling.letter) + 7 * spelling.octave;
}

// ---------- Chord qualities ----------
// intervals: semitones above root. omit: intervals that may be left out when detecting/voicing.
export const QUALITIES = [
  { id: 'maj', sym: '', name: 'major', iv: [0, 4, 7], omit: [] },
  { id: 'min', sym: 'm', name: 'minor', iv: [0, 3, 7], omit: [] },
  { id: 'dim', sym: 'dim', name: 'diminished', iv: [0, 3, 6], omit: [] },
  { id: 'aug', sym: 'aug', name: 'augmented', iv: [0, 4, 8], omit: [] },
  { id: 'sus2', sym: 'sus2', name: 'suspended 2nd', iv: [0, 2, 7], omit: [] },
  { id: 'sus4', sym: 'sus4', name: 'suspended 4th', iv: [0, 5, 7], omit: [] },
  { id: '5', sym: '5', name: 'power chord', iv: [0, 7], omit: [] },
  { id: '6', sym: '6', name: 'major 6th', iv: [0, 4, 7, 9], omit: [7] },
  { id: 'm6', sym: 'm6', name: 'minor 6th', iv: [0, 3, 7, 9], omit: [7] },
  { id: '7', sym: '7', name: 'dominant 7th', iv: [0, 4, 7, 10], omit: [7] },
  { id: 'maj7', sym: 'maj7', name: 'major 7th', iv: [0, 4, 7, 11], omit: [7] },
  { id: 'm7', sym: 'm7', name: 'minor 7th', iv: [0, 3, 7, 10], omit: [7] },
  { id: 'm7b5', sym: 'm7b5', name: 'half-diminished', iv: [0, 3, 6, 10], omit: [] },
  { id: 'dim7', sym: 'dim7', name: 'diminished 7th', iv: [0, 3, 6, 9], omit: [] },
  { id: 'mMaj7', sym: 'm(maj7)', name: 'minor-major 7th', iv: [0, 3, 7, 11], omit: [7] },
  { id: '7sus4', sym: '7sus4', name: 'dominant 7th sus4', iv: [0, 5, 7, 10], omit: [7] },
  { id: 'aug7', sym: '7#5', name: 'augmented 7th', iv: [0, 4, 8, 10], omit: [] },
  { id: 'add9', sym: 'add9', name: 'add 9', iv: [0, 4, 7, 14], omit: [7] },
  { id: 'madd9', sym: 'madd9', name: 'minor add 9', iv: [0, 3, 7, 14], omit: [7] },
  { id: '69', sym: '6/9', name: '6/9', iv: [0, 4, 7, 9, 14], omit: [7] },
  { id: '9', sym: '9', name: 'dominant 9th', iv: [0, 4, 7, 10, 14], omit: [7] },
  { id: 'maj9', sym: 'maj9', name: 'major 9th', iv: [0, 4, 7, 11, 14], omit: [7] },
  { id: 'm9', sym: 'm9', name: 'minor 9th', iv: [0, 3, 7, 10, 14], omit: [7] },
  { id: '7b9', sym: '7b9', name: 'dominant 7th flat 9', iv: [0, 4, 7, 10, 13], omit: [7] },
  { id: '13', sym: '13', name: 'dominant 13th', iv: [0, 4, 7, 10, 14, 21], omit: [7, 14] },
];
export const QUALITY_BY_ID = Object.fromEntries(QUALITIES.map((q) => [q.id, q]));

const QUALITY_ALIASES = {
  '': 'maj', M: 'maj', maj: 'maj', major: 'maj',
  m: 'min', min: 'min', '-': 'min', mi: 'min', minor: 'min',
  dim: 'dim', o: 'dim', '°': 'dim',
  aug: 'aug', '+': 'aug',
  sus2: 'sus2', sus4: 'sus4', sus: 'sus4',
  5: '5',
  6: '6', maj6: '6', M6: '6', m6: 'm6', min6: 'm6', '-6': 'm6',
  7: '7', dom7: '7',
  maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', ma7: 'maj7',
  m7: 'm7', min7: 'm7', '-7': 'm7', mi7: 'm7',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', 'm7(b5)': 'm7b5', '-7b5': 'm7b5',
  dim7: 'dim7', o7: 'dim7', '°7': 'dim7',
  'm(maj7)': 'mMaj7', mMaj7: 'mMaj7', mM7: 'mMaj7', 'm(M7)': 'mMaj7', minmaj7: 'mMaj7',
  '7sus4': '7sus4', '7sus': '7sus4',
  '7#5': 'aug7', aug7: 'aug7', '+7': 'aug7', '7+': 'aug7',
  add9: 'add9', add2: 'add9', '2': 'add9', madd9: 'madd9', 'm(add9)': 'madd9',
  69: '69', '6/9': '69', 6.9: '69',
  9: '9', maj9: 'maj9', M9: 'maj9', m9: 'm9', min9: 'm9', '-9': 'm9',
  '7b9': '7b9', '7(b9)': '7b9',
  13: '13',
};

/**
 * Parse a chord symbol: "C", "F#m7", "Bb/D", "G7/B", "Ebmaj7", "N.C.".
 * Returns {root, rootPc, quality, bass, bassPc, pcs:[...], symbol} or null. N.C. -> {nc:true}.
 */
export function parseChordSymbol(sym) {
  if (typeof sym !== 'string') return null;
  const s = sym.trim();
  if (/^(n\.?c\.?|nc|-|none)$/i.test(s)) return { nc: true, symbol: 'N.C.', pcs: [] };
  const m = /^([A-G])(#|b|♯|♭)?(.*)$/.exec(s);
  if (!m) return null;
  const root = m[1] + (m[2] ? (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]) : '');
  let rest = m[3].trim();
  let bass = null;
  // slash bass (but not the "6/9" quality)
  const sl = /^(.*?)\/([A-G](?:#|b)?)$/.exec(rest);
  if (sl && !/6$/.test(sl[1]) ) { rest = sl[1]; bass = sl[2]; }
  else if (sl && /6$/.test(sl[1]) && sl[2] !== '9') { rest = sl[1]; bass = sl[2]; }
  const qid = QUALITY_ALIASES[rest] ?? QUALITY_ALIASES[rest.replace(/[()]/g, '')];
  if (!qid) return null;
  const q = QUALITY_BY_ID[qid];
  const rootPc = parsePitchClass(root);
  const bassPc = bass ? parsePitchClass(bass) : rootPc;
  const pcs = [...new Set(q.iv.map((i) => mod12(rootPc + i)))];
  return { root, rootPc, quality: qid, bass: bass || root, bassPc, pcs, symbol: root + q.sym + (bass ? '/' + bass : '') };
}

export function chordSymbol(rootPc, qid, bassPc = null, names = ROOT_NAMES) {
  const q = QUALITY_BY_ID[qid];
  const rootName = names[mod12(rootPc)];
  let s = rootName + q.sym;
  if (bassPc != null && mod12(bassPc) !== mod12(rootPc)) s += '/' + spellInterval(rootName, mod12(bassPc - rootPc), names[mod12(bassPc)]);
  return s;
}

// letter steps for a chord-tone interval above the root (3rds -> 2 letters, 5ths -> 4, 7ths -> 6 ...)
const IV_LETTER_STEPS = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6 };
/** Spell the note `iv` semitones above `rootName` with the correct letter (A + 4 -> C#, not Db). */
export function spellInterval(rootName, iv, fallback) {
  const steps = IV_LETTER_STEPS[iv];
  if (steps == null) return fallback;
  const L = LETTERS[(LETTERS.indexOf(rootName[0]) + steps) % 7];
  const target = mod12(parsePitchClass(rootName) + iv);
  let acc = mod12(target - LETTER_PC[L]);
  if (acc > 6) acc -= 12;
  if (Math.abs(acc) > 1) return fallback;
  return L + (acc === 1 ? '#' : acc === -1 ? 'b' : '');
}

/** Root-name table for a key (flat keys -> flats). */
export function namesForKey(key) {
  if (!key) return ROOT_NAMES;
  const k = parseKey(key);
  return k.fifths < 0 ? FLAT_NAMES : k.fifths > 0 ? SHARP_NAMES.map((n, i) => (i === 10 ? 'Bb' : n)) : ROOT_NAMES;
}

const INV_NAMES = ['root position', '1st inversion', '2nd inversion', '3rd inversion'];

/** Which inversion is a given bass interval for a quality (or -1 if non-chord bass). */
export function inversionOf(qid, bassInterval) {
  const ivs = QUALITY_BY_ID[qid].iv.map(mod12);
  const uniq = [...new Set(ivs)].sort((a, b) => a - b);
  // order chord tones as root, 3rd(ish), 5th, 7th, extensions
  const idx = uniq.indexOf(mod12(bassInterval));
  return idx;
}

/**
 * Detect chord(s) from a set of MIDI notes. Returns array of candidates sorted best-first:
 * {symbol, rootPc, quality, bassPc, inversion, inversionName, score, missing:[intervals omitted]}
 */
export function detectChords(notes, { key = null, maxResults = 3 } = {}) {
  const ns = [...new Set(notes)].sort((a, b) => a - b);
  if (ns.length === 0) return [];
  const names = namesForKey(key);
  const pcs = [...new Set(ns.map(mod12))];
  const bassPc = mod12(ns[0]);
  if (pcs.length === 1) {
    return [{ symbol: names[pcs[0]], single: true, rootPc: pcs[0], quality: null, bassPc, inversion: 0, inversionName: '', score: 0 }];
  }
  const results = [];
  for (const root of pcs) {
    for (const q of QUALITIES) {
      const req = [...new Set(q.iv.map(mod12))];
      const have = new Set(pcs.map((p) => mod12(p - root)));
      const missing = req.filter((i) => !have.has(i));
      if (missing.some((i) => !q.omit.map(mod12).includes(i))) continue;
      const extras = [...have].filter((i) => !req.includes(i));
      if (extras.length) continue;
      if (req.length - missing.length < 2) continue;
      // two-note sets: only accept power chord (5) and major/minor third dyads are not chords
      if (pcs.length === 2 && q.id !== '5') continue;
      let score = 100 - missing.length * 6 - req.length * 1.5;
      if (root === bassPc) score += 8;
      if (q.id === 'maj' || q.id === 'min') score += 3;
      if (q.id === '7' || q.id === 'm7' || q.id === 'maj7') score += 1;
      if (q.id === 'aug' || q.id === 'dim7') score -= 2; // symmetric: prefer bass as root via bonus above
      const bassIv = mod12(bassPc - root);
      const inv = inversionOf(q.id, bassIv);
      results.push({
        symbol: chordSymbol(root, q.id, bassPc, names),
        rootPc: root, quality: q.id, bassPc, inversion: inv,
        inversionName: req.length <= 4 && inv >= 0 ? INV_NAMES[inv] : inv === 0 ? 'root position' : 'bass: ' + names[bassPc],
        score, missing,
      });
    }
  }
  if (!results.length && pcs.length === 2) {
    const iv = mod12(pcs.find((p) => p !== bassPc) - bassPc);
    const IV = ['unison', 'm2', 'M2', 'm3', 'M3', 'P4', 'tritone', 'P5', 'm6', 'M6', 'm7', 'M7'];
    return [{ symbol: names[bassPc] + ' + ' + IV[iv], interval: true, rootPc: bassPc, quality: null, bassPc, inversion: 0, inversionName: 'interval', score: 0 }];
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

export function detectChordName(notes, opts) {
  const r = detectChords(notes, opts);
  return r.length ? r[0].symbol : '';
}

/** Ordered chord tones (pcs) of a parsed chord: root, 3rd, 5th, 7th, extensions. */
export function chordTonesOrdered(parsed) {
  const q = QUALITY_BY_ID[parsed.quality];
  return q.iv.map((i) => mod12(parsed.rootPc + i));
}

/**
 * Build a close-position voicing for an inversion. inversion 0..n-1; the chord is
 * built ascending from the inversion's bass, lowest note >= lowMidi.
 */
export function voiceChord(rootPc, qid, inversion = 0, lowMidi = 48) {
  const q = QUALITY_BY_ID[qid];
  const ivs = [...new Set(q.iv.map(mod12))].sort((a, b) => a - b);
  const rotated = ivs.slice(inversion).concat(ivs.slice(0, inversion));
  const out = [];
  let prev = lowMidi - 1;
  for (const iv of rotated) {
    let n = prev + 1;
    while (mod12(n) !== mod12(rootPc + iv)) n++;
    out.push(n);
    prev = n;
  }
  return out;
}

export function inversionCount(qid) {
  return new Set(QUALITY_BY_ID[qid].iv.map(mod12)).size;
}
export const INVERSION_NAMES = INV_NAMES;

// ---------- Durations ----------
const DUR_LETTERS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 };
/** Parse "1", "0.5", "1.5", "3/2", "1/3", "q", "h.", "e" -> beats (quarter notes). */
export function parseDuration(d) {
  if (typeof d === 'number') return d > 0 ? d : null;
  if (typeof d !== 'string') return null;
  const s = d.trim();
  let m;
  if ((m = /^([whqest])(\.{0,2})(t?)$/.exec(s))) {
    let v = DUR_LETTERS[m[1]];
    if (m[2].length === 1) v *= 1.5;
    if (m[2].length === 2) v *= 1.75;
    if (m[3]) v = (v * 2) / 3;
    return v;
  }
  if ((m = /^(\d+)\/(\d+)$/.exec(s))) return +m[1] / +m[2] || null;
  const v = parseFloat(s);
  return isFinite(v) && v > 0 && /^\d*\.?\d+$/.test(s) ? v : null;
}

export function parseTimeSignature(ts) {
  if (Array.isArray(ts)) return { num: ts[0], den: ts[1] };
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(ts || '4/4');
  return m ? { num: +m[1], den: +m[2] } : { num: 4, den: 4 };
}
export function beatsPerMeasure(ts) {
  const t = parseTimeSignature(ts);
  return (t.num * 4) / t.den;
}
