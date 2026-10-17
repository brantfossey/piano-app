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

// ---------------- "Paste chord sheet" importer ----------------
// Monospace chord sheets as copied from chord apps (Ultimate Guitar, Moises, ...): a line of chords with the lyric line
// beneath it, chords placed at the column of the syllable they belong to, and "[Verse 1]" section headers.

// chord-ish token: root, quality made of known chord words/digits/accidentals, optional slash bass
const CHORDISH = /^[A-G][#b♯♭]?(?:maj|min|dim|aug|sus|add|alt|omit|no|m|M|[0-9#b♯♭+°øΔ()\-,])*(?:\/[A-G][#b♯♭]?)?$/;
// tokens allowed on a chord line that are not chords (bar lines, repeat marks, ...)
const ANNOTATION = /^(?:\|+|:?\|\|?:?|x\d+|\(x\d+\)|\d+x|\(\d+x\)|-+|%|\/+|\.{2,}|\*+|\(|\))$/i;
const SECTION_WORDS = 'intro|verse|chorus|pre-?chorus|bridge|outro|solo|interlude|instrumental|refrain|hook|tag|coda|ending|break|post-?chorus|riff';
// quality replacements for chord types the app does not know (simplify option); first match wins
const SIMPLIFY_QUALITY = [
  [/^7sus2$/, '7sus4'], [/^9sus4?$/, '7sus4'], [/^13sus4?$/, '7sus4'], [/^11$/, '7sus4'], [/^sus2sus4$|^sus24$/, 'sus4'],
  [/^m11$|^m13$|^min11$|^-11$/, 'm7'], [/^maj11$|^maj13$|^M13$/, 'maj9'], [/^6add9$|^69$/, '6/9'], [/^m69$|^m6\/9$/, 'm6'],
  [/^m7#5$/, 'm7'], [/^maj7#5$/, 'maj7'], [/^add11$|^add4$/, ''], [/^madd11$|^madd4$|^m\(add11\)$/, 'm'],
];

function cleanToken(t) {
  let s = t.replace(/♯/g, '#').replace(/♭/g, 'b');
  if (/^\[[^\]]+\]$/.test(s)) s = s.slice(1, -1); // "[Am]" -> "Am"
  if (/^\(.*\)$/.test(s) && !/^\([^)]*\)[^)]+/.test(s)) s = s.slice(1, -1); // "(Am)" -> "Am"
  return s;
}

/**
 * Make a chord symbol the app understands. Returns {symbol, replaced:boolean} or null when it can't be read at all.
 * Tries: as written; known replacements (Bb7sus2 -> Bb7sus4); dropping "(...)" alterations (Am7(#5) -> Am7);
 * finally trimming the quality from the right (Cmaj7#11 -> Cmaj7). Slash basses are kept.
 */
export function simplifyChordSymbol(sym) {
  const s = cleanToken(String(sym || '').trim());
  if (parseChordSymbol(s)) return { symbol: s, replaced: false };
  const m = /^([A-G][#b]?)(.*?)(\/[A-G][#b]?)?$/.exec(s);
  if (!m) return null;
  const [, root, qual, bass = ''] = m;
  const ok = (q) => (parseChordSymbol(root + q + bass) ? root + q + bass : (parseChordSymbol(root + q) ? root + q : null));
  const cands = [];
  for (const [re, rep] of SIMPLIFY_QUALITY) if (re.test(qual)) cands.push(rep);
  const noParen = qual.replace(/\([^)]*\)/g, '');
  cands.push(noParen);
  for (const [re, rep] of SIMPLIFY_QUALITY) if (re.test(noParen)) cands.push(rep);
  for (let i = noParen.length - 1; i >= 0; i--) cands.push(noParen.slice(0, i));
  for (const q of cands) { const r = ok(q); if (r) return { symbol: r, replaced: true }; }
  return null;
}

function tokenize(line) {
  const out = []; const re = /\S+/g; let m;
  while ((m = re.exec(line))) out.push({ text: m[0], col: m.index });
  return out;
}

function isChordToken(t) {
  const s = cleanToken(t);
  return /^(n\.?c\.?)$/i.test(s) || (CHORDISH.test(s) && !!simplifyChordSymbol(s));
}

/** Classify one (tab-expanded, tag-stripped) line: chords | section | blank | lyric. */
export function classifySheetLine(line) {
  if (!line.trim()) return { kind: 'blank' };
  const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  if (sec && !parseChordSymbol(sec[1].trim())) return { kind: 'section', label: sec[1].trim() };
  const lab = new RegExp(`^\\s*\\(?((?:${SECTION_WORDS})(?:\\s*\\d+)?(?:\\s*\\([^)]*\\))?)\\)?\\s*:?\\s*(.*)$`, 'i').exec(line);
  if (lab && (/:/.test(line) || !lab[2].trim() || /^\s*\(/.test(line))) {
    const rest = lab[2];
    if (!rest.trim()) return { kind: 'section', label: lab[1].trim() };
    const offset = line.length - rest.length;
    const sub = classifySheetLine(' '.repeat(offset) + rest);
    if (sub.kind === 'chords') return { kind: 'chords', label: lab[1].trim(), tokens: sub.tokens };
  }
  const toks = tokenize(line);
  let chords = 0, other = 0;
  for (const t of toks) { if (isChordToken(t.text)) chords++; else if (!ANNOTATION.test(t.text)) other++; }
  if (chords && !other) return { kind: 'chords', tokens: toks };
  return { kind: 'lyric' };
}

/**
 * Convert a pasted monospace chord sheet into lyricsText (inline [Chord] before the syllable).
 * Options: simplify (default true) replaces chord types the app doesn't know with the closest one it does;
 * tabWidth (default 4) for tab characters.
 * Returns {text, replaced:[{from,to,count}], unknown:[symbols kept as written], stats:{chordLines,lyricLines,sections}}.
 */
export function convertChordSheet(input, { simplify = true, tabWidth = 4 } = {}) {
  const src = String(input ?? '').replace(/\r\n?/g, '\n')
    .replace(/\[\/?(?:ch|tab)\]/gi, '') // Ultimate Guitar markup, if copied from the source view
    .replace(/\u00a0/g, ' ')
    .split('\n').map((l) => {
      let out = '';
      for (const ch of l) out += ch === '\t' ? ' '.repeat(tabWidth - (out.length % tabWidth)) : ch;
      return out.replace(/\s+$/, '');
    });
  const replacedMap = new Map(), unknown = new Set();
  const stats = { chordLines: 0, lyricLines: 0, sections: 0 };
  const sym = (raw) => {
    const t = cleanToken(raw);
    if (/^(n\.?c\.?)$/i.test(t)) return 'N.C.';
    if (parseChordSymbol(t)) return t;
    if (simplify) {
      const r = simplifyChordSymbol(t);
      if (r) { const k = t + '\u0000' + r.symbol; const e = replacedMap.get(k) || { from: t, to: r.symbol, count: 0 }; e.count++; replacedMap.set(k, e); return r.symbol; }
    }
    unknown.add(t); return t;
  };
  const out = [];
  const pushBlank = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  const chordOnly = (tokens) => tokens.map((t) => (ANNOTATION.test(t.text) ? (/^\|+$|^:?\|\|?:?$/.test(t.text) ? null : t.text) : `[${sym(t.text)}]`))
    .filter(Boolean).join(' ');
  const cls = src.map(classifySheetLine);
  for (let i = 0; i < src.length; i++) {
    const c = cls[i];
    if (c.kind === 'blank') { pushBlank(); continue; }
    if (c.kind === 'section') { pushBlank(); out.push(`[${c.label}]`); stats.sections++; continue; }
    if (c.kind === 'lyric') { out.push(src[i].trim()); stats.lyricLines++; continue; }
    // chord line
    stats.chordLines++;
    if (c.label) { pushBlank(); out.push(`[${c.label}]`); stats.sections++; }
    const next = cls[i + 1];
    if (c.label || !next || next.kind !== 'lyric') { out.push(chordOnly(c.tokens)); continue; }
    out.push(mergeChordsIntoLyric(c.tokens.filter((t) => !ANNOTATION.test(t.text)), src[i + 1], sym));
    stats.lyricLines++; i++;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return { text: out.join('\n'), replaced: [...replacedMap.values()], unknown: [...unknown], stats };
}

// Insert [Chord] into the lyric line at the column of each chord (a chord over a space moves onto the next word
// when that word starts within 2 columns, or anywhere in the leading indent). Chords past the end go after the text.
function mergeChordsIntoLyric(tokens, lyric, sym) {
  const firstChar = lyric.search(/\S/);
  const places = tokens.map((t, k) => {
    let col = t.col;
    const nextCol = k + 1 < tokens.length ? tokens[k + 1].col : Infinity;
    if (col < firstChar) col = Math.min(firstChar, nextCol > firstChar ? firstChar : col);
    else if (col < lyric.length && lyric[col] === ' ') {
      const j = lyric.slice(col).search(/\S/);
      if (j > 0 && j <= 2 && col + j < nextCol) col += j;
    }
    return { col: Math.min(col, lyric.length), chord: sym(t.text), end: col >= lyric.length };
  });
  let s = '', pos = 0;
  for (const p of places) {
    s += lyric.slice(pos, p.col); pos = p.col;
    if (p.end && s && !/\s$/.test(s)) s += ' ';
    s += `[${p.chord}]`;
  }
  s += lyric.slice(pos);
  return s.replace(/^\s+/, '').replace(/\s+$/, '');
}

/** True when lyricsText/lines hold chords only: no real words, just "_" slots, spaces and section headers. */
export function isPlaceholderLyrics(textOrLines) {
  const lines = typeof textOrLines === 'string' ? parseLyricsText(textOrLines).lines : (textOrLines || []);
  return !lines.some((l) => l.type === 'line' && l.segs.some((s) => /[\p{L}\p{N}]/u.test(s.text)));
}
