// Lyrics & chords (Ultimate-Guitar style chord sheets) and the follow-along engine.
// Pure functions, no DOM — usable from the browser and from Node tests.
//
// Text form ("lyricsText"), ChordPro-like inline chords:
//   [Verse 1]
//   A[G]mazing [G7]grace, how [C]sweet the [G]sound
//   That saved a [Em]wretch like [D]me [D7]
// A chord in [brackets] sits above the text that follows it. A line that is only "[Something]"
// and not a chord symbol is a section header. Empty lines separate blocks.
import { parseChordSymbol, mod12, voiceChord, QUALITY_BY_ID, namesForKey, spellInterval, beatsPerMeasure } from './theory.js';

const EPS = 1e-6;

/** Parse lyricsText. Returns {lines, errors, warnings}. lines: {type:'line', segs:[{chord|null,text}]} | {type:'section', label} | {type:'blank'} */
export function parseLyricsText(text) {
  const lines = [], errors = [], warnings = [];
  String(text ?? '').replace(/\r/g, '').split('\n').forEach((rawLine, i) => {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) { if (lines.length && lines[lines.length - 1].type !== 'blank') lines.push({ type: 'blank' }); return; }
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sec && !parseChordSymbol(sec[1].trim())) { lines.push({ type: 'section', label: sec[1].trim() }); return; }
    const r = parseLyricLine(line, `line ${i + 1}`);
    errors.push(...r.errors); warnings.push(...r.warnings);
    lines.push({ type: 'line', segs: r.segs });
  });
  while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();
  return { lines, errors, warnings };
}

/** Parse one line with inline [chords]. */
export function parseLyricLine(line, label = 'line') {
  const segs = [], errors = [], warnings = [];
  let cur = { chord: null, text: '' };
  const re = /\[([^\]]*)\]/g;
  let last = 0, m;
  while ((m = re.exec(line))) {
    cur.text += line.slice(last, m.index);
    last = re.lastIndex;
    const sym = m[1].trim();
    const pc = parseChordSymbol(sym);
    if (!pc) {
      warnings.push(`lyrics ${label}: "[${m[1]}]" is not a known chord symbol, kept as text`);
      cur.text += m[0];
      continue;
    }
    if (cur.chord || cur.text) segs.push(cur);
    cur = { chord: pc.nc ? 'N.C.' : sym, text: '' };
  }
  cur.text += line.slice(last);
  if (cur.chord || cur.text) segs.push(cur);
  if (line.includes('[') && !line.includes(']')) warnings.push(`lyrics ${label}: unclosed "["`);
  return { segs, errors, warnings };
}

/**
 * Accept the array form: "lyrics": ["[G]Amazing grace", {"section":"Chorus"}, {"segments":[{"chord":"C","text":"sweet"}]}, ""]
 * or a single string (same as lyricsText).
 */
export function parseLyricsField(value) {
  if (typeof value === 'string') return parseLyricsText(value);
  if (!Array.isArray(value)) return { lines: [], errors: ['lyrics must be a string or an array'], warnings: [] };
  const lines = [], errors = [], warnings = [];
  value.forEach((item, i) => {
    if (typeof item === 'string') {
      const r = parseLyricsText(item);
      errors.push(...r.errors); warnings.push(...r.warnings);
      if (!r.lines.length) lines.push({ type: 'blank' }); else lines.push(...r.lines);
    } else if (item && typeof item === 'object' && typeof item.section === 'string') {
      lines.push({ type: 'section', label: item.section });
    } else if (item && typeof item === 'object' && Array.isArray(item.segments)) {
      const segs = [];
      item.segments.forEach((s, j) => {
        const chord = s?.chord != null && String(s.chord).trim() !== '' ? String(s.chord).trim() : null;
        const text = s?.text ?? s?.lyric ?? '';
        const pc = chord ? parseChordSymbol(chord) : null;
        if (chord && !pc) errors.push(`lyrics[${i}].segments[${j}]: unknown chord symbol "${chord}"`);
        segs.push({ chord: chord && pc ? (pc.nc ? 'N.C.' : chord) : null, text: String(text) });
      });
      lines.push({ type: 'line', segs });
    } else errors.push(`lyrics[${i}] must be a string, {"section":...} or {"segments":[...]}`);
  });
  return { lines, errors, warnings };
}

/** Serialize lines back to lyricsText. */
export function lyricsToText(lines) {
  return (lines || []).map((l) => l.type === 'blank' ? '' : l.type === 'section' ? `[${l.label}]`
    : l.segs.map((s) => (s.chord ? `[${s.chord}]` : '') + s.text).join('')).join('\n');
}

/**
 * Backward compatibility: build a chord sheet from the melody's lyric syllables and the chord timeline
 * (songs without a lyrics field). Syllables ending in "-" join the next one. Repeated chords are merged.
 * Without any syllables the result is a chord chart (one segment per chord change, barsPerLine bars per line).
 */
export function deriveLyrics(song, { barsPerLine = 4 } = {}) {
  const bpm = beatsPerMeasure(song.timeSignature || '4/4');
  const pickup = song.pickupBeats || 0;
  const barOf = (b) => (b < pickup - EPS ? -1 : Math.floor((b - pickup) / bpm + EPS));
  const lineOf = (b) => Math.floor(Math.max(0, barOf(b)) / barsPerLine);
  const syl = (song.melody || []).filter((e) => e.lyric).map((e) => ({ beat: e.beat, kind: 'syl', text: e.lyric }));
  const chords = (song.chords || []).map((c) => ({ beat: c.beat, kind: 'chord', symbol: c.symbol }));
  const evs = [...chords, ...syl].sort((a, b) => a.beat - b.beat || (a.kind === 'chord' ? -1 : 1));
  if (!evs.length) return [];
  const lines = [];
  let line = null, lineNo = null, seg = null, prevChord = null;
  for (const e of evs) {
    const ln = lineOf(e.beat);
    if (ln !== lineNo) { line = { type: 'line', segs: [] }; lines.push(line); lineNo = ln; seg = null; }
    if (e.kind === 'chord') {
      if (e.symbol === prevChord) continue;
      prevChord = e.symbol;
      if (seg && !seg.text && !seg.chord) { seg.chord = e.symbol; continue; }
      seg = { chord: e.symbol, text: '' }; line.segs.push(seg);
    } else {
      if (!seg) { seg = { chord: null, text: '' }; line.segs.push(seg); }
      let t = e.text;
      const hyph = /-$/.test(t);
      if (hyph) t = t.slice(0, -1);
      seg.text += t + (hyph ? '' : ' ');
    }
  }
  for (const l of lines) for (const s of l.segs) s.text = s.text.replace(/\s+$/, ' ');
  for (const l of lines) { const last = l.segs[l.segs.length - 1]; if (last) last.text = last.text.replace(/\s+$/, ''); }
  return lines.filter((l) => l.segs.length);
}

/** Lines to show for a song: its own lyrics, else derived. Returns {lines, derived:boolean, hasWords:boolean}. */
export function songSheet(song) {
  if (song?.lyrics?.length) return { lines: song.lyrics, derived: false, hasWords: true };
  const lines = song ? deriveLyrics(song) : [];
  return { lines, derived: true, hasWords: lines.some((l) => l.segs.some((s) => s.text.trim())) };
}

/** Ordered follow-along targets: every chord in the sheet (N.C. skipped). */
export function followSequence(lines) {
  const seq = [];
  (lines || []).forEach((l, li) => {
    if (l.type !== 'line') return;
    l.segs.forEach((s, si) => {
      if (!s.chord || s.chord === 'N.C.') return;
      const p = parseChordSymbol(s.chord);
      if (p && !p.nc) seq.push({ symbol: s.chord, line: li, seg: si, text: s.text, parsed: p });
    });
  });
  return seq;
}

/** Pitch classes that must be present: every chord tone except the ones a voicing may omit (5th of 7th chords, 9th of 13ths). */
export function requiredPcs(symbol) {
  const p = typeof symbol === 'string' ? parseChordSymbol(symbol) : symbol;
  if (!p || p.nc) return [];
  const q = QUALITY_BY_ID[p.quality];
  const need = q.iv.filter((i) => !q.omit.includes(i)).map((i) => mod12(p.rootPc + i));
  return [...new Set(need)];
}

/** Tolerant chord match: any inversion / voicing / octave, extra notes allowed. Returns {ok, missing:[pc]}. */
export function chordMatch(symbol, notes) {
  const need = requiredPcs(symbol);
  const have = new Set((notes || []).map(mod12));
  const missing = need.filter((pc) => !have.has(pc));
  return { ok: need.length > 0 && missing.length === 0, missing };
}

/** A suggested voicing to highlight: bass note (slash bass or root) in octave 3, close root-position chord from C4 up. */
export function targetVoicing(symbol) {
  const p = typeof symbol === 'string' ? parseChordSymbol(symbol) : symbol;
  if (!p || p.nc) return [];
  const bass = 48 + mod12(p.bassPc);
  const upper = voiceChord(p.rootPc, p.quality, 0, 60);
  return [...new Set([bass, ...upper])].sort((a, b) => a - b);
}

/** Chord tone names spelled from the root (A -> A C# E). */
export function chordToneNames(symbol, key) {
  const p = typeof symbol === 'string' ? parseChordSymbol(symbol) : symbol;
  if (!p || p.nc) return [];
  const names = namesForKey(key);
  return QUALITY_BY_ID[p.quality].iv.map((i) => spellInterval(p.root, mod12(i), names[mod12(p.rootPc + i)]) || names[mod12(p.rootPc + i)])
    .filter((n, i, a) => a.indexOf(n) === i);
}

/**
 * Follow-along for a song playing in the room (the app does not hear it): the current chord waits until the
 * player plays it. Counted notes = keys held now + keys struck within `windowSec` (so broken chords / arpeggios
 * work). At least one key must be struck after the chord became current, so a chord held over from the previous
 * step never skips ahead on its own. Events: {type:'advance'|'move'|'finished'|'partial', index, ...}
 */
export class FollowAlong {
  constructor(seq, { windowSec = 1.5, onEvent = () => {} } = {}) {
    this.seq = seq || []; this.windowSec = windowSec; this.onEvent = onEvent;
    this.index = 0; this.held = new Set(); this.struck = new Map(); this.matched = 0;
  }
  get current() { return this.seq[this.index] || null; }
  get done() { return this.index >= this.seq.length; }
  counted(t) {
    const out = new Set(this.held);
    for (const [n, st] of this.struck) if (t - st <= this.windowSec + EPS) out.add(n);
    return [...out].sort((a, b) => a - b);
  }
  noteOn(note, t) {
    this.held.add(note);
    if (this.done) return null;
    this.struck.set(note, t);
    return this.check(t);
  }
  noteOff(note) { this.held.delete(note); }
  check(t) {
    const cur = this.current;
    if (!cur || !this.struck.size) return null;
    const notes = this.counted(t);
    const r = chordMatch(cur.parsed, notes);
    if (r.ok) {
      this.matched++;
      this.index++; this.struck.clear();
      this.onEvent({ type: 'advance', index: this.index, played: cur, notes });
      if (this.done) this.onEvent({ type: 'finished', index: this.index });
      return r;
    }
    this.onEvent({ type: 'partial', index: this.index, missing: r.missing, notes });
    return r;
  }
  goto(i) {
    this.index = Math.max(0, Math.min(this.seq.length, i)); this.struck.clear();
    this.onEvent({ type: 'move', index: this.index });
  }
  next() { this.goto(this.index + 1); }
  back() { this.goto(this.index - 1); }
  restart() { this.matched = 0; this.goto(0); }
}
