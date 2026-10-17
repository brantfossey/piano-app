// Song JSON format: parsing, validation, normalization and serialization.
// See README.md "Song JSON format" for the human/AI-facing documentation.
import { parsePitch, parseDuration, parseChordSymbol, beatsPerMeasure, midiToName, parseKey } from './theory.js';
import { parseLyricsText, parseLyricsField, lyricsToText } from './lyrics.js';

export const FORMAT_ID = 'piano-song';
export const FORMAT_VERSION = 1;
const EPS = 1e-6;
const round = (x) => Math.round(x * 1000) / 1000;

/**
 * Parse note text like "| D4:1 | G4:2 B4:e G4:e | E4+G4:h r:q |".
 * Token: pitch[+pitch...][:duration] | r[:duration] | "|" (bar check).
 * Duration defaults to the previous token's duration (initially 1 beat).
 * Returns {events:[{beat,dur,pitches:[midi]}], warnings:[], errors:[], totalBeats}.
 */
export function parseNoteText(text, { timeSignature = '4/4', pickupBeats = 0, label = 'notes', startBeat = 0 } = {}) {
  const bpm = beatsPerMeasure(timeSignature);
  const events = [], warnings = [], errors = [];
  let beat = startBeat, lastDur = 1, barStart = startBeat, barIndex = 0;
  const tokens = String(text || '').replace(/\r/g, '').split(/\s+/).filter(Boolean);
  const barLens = [];
  const checkBar = (final) => {
    const len = beat - barStart;
    if (final && len < EPS) return;
    barLens.push(len);
    barIndex++;
    barStart = beat;
  };
  let leadingBar = true;
  for (const tokRaw of tokens) {
    if (/^\|+:?$|^:?\|+$|^\|\|$/.test(tokRaw)) {
      if (leadingBar && beat === startBeat) continue; // a leading "|" is decoration
      if (Math.abs(beat - barStart) < EPS && barIndex > 0) continue; // "| |" or line-wrapped "|\n|"
      checkBar(false);
      continue;
    }
    leadingBar = false;
    let tok = tokRaw, lyric;
    const ly = /^(.*?)"(.*)"$/.exec(tok); // optional lyric: G4:1"grace"
    if (ly) { tok = ly[1]; lyric = ly[2]; }
    const [pStr, dStr] = tok.split(':');
    let dur = lastDur;
    if (dStr !== undefined) {
      const d = parseDuration(dStr);
      if (d == null) { errors.push(`${label}: bad duration "${dStr}" in "${tokRaw}"`); continue; }
      dur = d;
    }
    lastDur = dur;
    if (/^(r|rest|x|-)$/i.test(pStr)) { beat += dur; continue; }
    const pitches = pStr.split('+').map(parsePitch);
    if (pitches.some((p) => p == null)) { errors.push(`${label}: bad pitch in "${tokRaw}"`); beat += dur; continue; }
    const ev = { beat: round(beat), dur: round(dur), pitches: [...new Set(pitches)].sort((a, b) => a - b) };
    if (lyric) ev.lyric = lyric;
    events.push(ev);
    beat += dur;
  }
  checkBar(true);
  barLens.forEach((len, i) => {
    const expected = i === 0 && pickupBeats > 0 ? pickupBeats : bpm;
    const last = i === barLens.length - 1 && i > 0;
    if (Math.abs(len - expected) > EPS && !(last && len < expected)) {
      const n = pickupBeats > 0 ? (i === 0 ? 'pickup' : i) : i + 1;
      warnings.push(`${label}: bar ${n} has ${round(len)} beats, expected ${expected}`);
    }
  });
  return { events, warnings, errors, totalBeats: round(beat) };
}

/**
 * Parse chord text like "| N.C. | G | G7 | C G/B | Am:2 D7:1 |".
 * Token: symbol[:duration]. Tokens without duration share the remaining bar length equally.
 * "%" repeats the previous chord.
 */
export function parseChordText(text, { timeSignature = '4/4', pickupBeats = 0 } = {}) {
  const bpm = beatsPerMeasure(timeSignature);
  const chords = [], warnings = [], errors = [];
  const bars = String(text || '').replace(/\r/g, '').replace(/\|\s*\n\s*\|/g, '|').split('|').map((b) => b.trim());
  // drop empty leading/trailing caused by outer pipes
  if (bars.length && bars[0] === '') bars.shift();
  if (bars.length && bars[bars.length - 1] === '') bars.pop();
  let beat = 0, prev = null;
  bars.forEach((bar, i) => {
    const len = i === 0 && pickupBeats > 0 ? pickupBeats : bpm;
    const toks = bar.split(/\s+/).filter(Boolean);
    if (!toks.length) { beat += len; return; }
    const parsed = toks.map((t) => {
      const idx = t.lastIndexOf(':');
      return idx > 0 ? { s: t.slice(0, idx), d: parseDuration(t.slice(idx + 1)) } : { s: t, d: null };
    });
    const fixed = parsed.reduce((a, p) => a + (p.d || 0), 0);
    const free = parsed.filter((p) => !p.d).length;
    const each = free ? (len - fixed) / free : 0;
    if (free && each <= EPS) warnings.push(`chords: bar ${i + 1} durations overflow`);
    if (!free && Math.abs(fixed - len) > EPS) warnings.push(`chords: bar ${i + 1} has ${fixed} beats, expected ${len}`);
    let b = beat;
    for (const p of parsed) {
      const dur = p.d || Math.max(each, 0);
      let sym = p.s;
      if (sym === '%' || sym === '/') sym = prev || 'N.C.';
      const pc = parseChordSymbol(sym);
      if (!pc) errors.push(`chords: unknown chord symbol "${p.s}" in bar ${i + 1}`);
      else chords.push({ beat: round(b), dur: round(dur), symbol: pc.nc ? 'N.C.' : sym });
      prev = sym;
      b += dur;
    }
    beat += len;
  });
  return { chords: mergeChords(chords), warnings, errors };
}

function mergeChords(chords) {
  // drop N.C. and keep as gaps; keep repeated same chord separate (re-articulation is musical)
  return chords.filter((c) => c.symbol !== 'N.C.');
}

function parseEventArray(arr, label, errors) {
  const out = [];
  (arr || []).forEach((e, i) => {
    if (!e || typeof e !== 'object') { errors.push(`${label}[${i}] is not an object`); return; }
    const beat = Number(e.beat ?? e.b);
    const dur = typeof e.dur === 'string' ? parseDuration(e.dur) : Number(e.dur ?? e.d);
    let raw = e.pitches ?? e.notes ?? (e.pitch != null ? [e.pitch] : e.note != null ? [e.note] : []);
    if (!Array.isArray(raw)) raw = [raw];
    const pitches = raw.map(parsePitch);
    if (!isFinite(beat) || beat < 0) { errors.push(`${label}[${i}] bad beat`); return; }
    if (!isFinite(dur) || dur <= 0) { errors.push(`${label}[${i}] bad dur`); return; }
    if (pitches.some((p) => p == null) || !pitches.length) { errors.push(`${label}[${i}] bad pitch(es): ${JSON.stringify(raw)}`); return; }
    const ev = { beat: round(beat), dur: round(dur), pitches: [...new Set(pitches)].sort((a, b) => a - b) };
    if (e.lyric) ev.lyric = String(e.lyric);
    if (e.finger) ev.finger = e.finger;
    out.push(ev);
  });
  return out.sort((a, b) => a.beat - b.beat);
}

const slug = (s) => String(s || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'song';

/**
 * Normalize any accepted song JSON (arrays and/or *Text fields) into the internal model:
 * {id,title,composer,key,timeSignature,tempo,pickupBeats,melody,chords,arrangement:{rightHand,leftHand}|null,...}
 * with pitches as MIDI numbers. Returns {song, errors, warnings}.
 */
export function normalizeSong(raw) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object') return { song: null, errors: ['Song is not an object'], warnings };
  const timeSignature = typeof raw.timeSignature === 'string' ? raw.timeSignature
    : Array.isArray(raw.timeSignature) ? raw.timeSignature.join('/') : '4/4';
  if (!/^\d+\/\d+$/.test(timeSignature)) errors.push('timeSignature must look like "4/4"');
  const pickupBeats = Number(raw.pickupBeats || 0);
  const opts = { timeSignature, pickupBeats };
  const key = raw.key || 'C';
  if (!parseKey(key)) warnings.push('unrecognized key, using C');

  const take = (arrField, textField, label) => {
    if (Array.isArray(raw[arrField])) return parseEventArray(raw[arrField], label, errors);
    if (typeof raw[textField] === 'string') {
      const r = parseNoteText(raw[textField], { ...opts, label });
      errors.push(...r.errors); warnings.push(...r.warnings);
      return r.events;
    }
    return null;
  };
  const melody = take('melody', 'melodyText', 'melody') || [];
  let chords = [];
  if (Array.isArray(raw.chords)) {
    raw.chords.forEach((c, i) => {
      const pc = parseChordSymbol(c?.symbol ?? c?.chord);
      const beat = Number(c?.beat), dur = Number(c?.dur);
      if (!pc) errors.push(`chords[${i}] unknown symbol ${JSON.stringify(c?.symbol)}`);
      else if (!isFinite(beat) || beat < 0) errors.push(`chords[${i}] bad beat`);
      else if (!pc.nc) chords.push({ beat: round(beat), dur: isFinite(dur) && dur > 0 ? round(dur) : null, symbol: c.symbol ?? c.chord });
    });
    chords.sort((a, b) => a.beat - b.beat);
  } else if (typeof raw.chordsText === 'string') {
    const r = parseChordText(raw.chordsText, opts);
    errors.push(...r.errors); warnings.push(...r.warnings);
    chords = r.chords;
  }
  const src = raw.arrangement && typeof raw.arrangement === 'object' ? raw.arrangement : raw;
  const lh = Array.isArray(src.leftHand) ? parseEventArray(src.leftHand, 'leftHand', errors)
    : typeof src.leftHandText === 'string' ? (() => { const r = parseNoteText(src.leftHandText, { ...opts, label: 'leftHand' }); errors.push(...r.errors); warnings.push(...r.warnings); return r.events; })()
    : null;
  const rh = Array.isArray(src.rightHand) ? parseEventArray(src.rightHand, 'rightHand', errors)
    : typeof src.rightHandText === 'string' ? (() => { const r = parseNoteText(src.rightHandText, { ...opts, label: 'rightHand' }); errors.push(...r.errors); warnings.push(...r.warnings); return r.events; })()
    : null;

  const ends = [...melody, ...(lh || []), ...(rh || [])].map((e) => e.beat + e.dur);
  const lastChordStart = chords.length ? chords[chords.length - 1].beat : 0;
  let totalBeats = Math.max(0, ...ends, lastChordStart + 1);
  const bpmz = beatsPerMeasure(timeSignature);
  // round total up to a full bar
  const afterPickup = totalBeats - pickupBeats;
  totalBeats = round(pickupBeats + Math.ceil(afterPickup / bpmz - EPS) * bpmz);
  // fill missing chord durations: until next chord or end
  chords.forEach((c, i) => {
    if (c.dur == null) c.dur = round((chords[i + 1]?.beat ?? totalBeats) - c.beat);
  });
  // optional lyrics with inline chords (Lyrics & Chords view). Older songs simply don't have them.
  let lyrics = null;
  const lyr = typeof raw.lyricsText === 'string' && raw.lyricsText.trim() ? parseLyricsText(raw.lyricsText)
    : raw.lyrics != null && raw.lyrics !== '' ? parseLyricsField(raw.lyrics) : null;
  if (lyr) { errors.push(...lyr.errors); warnings.push(...lyr.warnings); if (lyr.lines.length) lyrics = lyr.lines; }
  if (!melody.length && !(rh && rh.length) && !lyrics) warnings.push('song has no melody / right-hand notes');

  const song = {
    format: FORMAT_ID, version: FORMAT_VERSION,
    id: raw.id ? String(raw.id) : slug(raw.title) + '-' + Math.random().toString(36).slice(2, 7),
    title: String(raw.title || 'Untitled'),
    composer: raw.composer ? String(raw.composer) : '',
    arranger: raw.arranger ? String(raw.arranger) : '',
    source: raw.source ? String(raw.source) : '',
    placeholder: !!raw.placeholder,
    notes: raw.notes ? String(raw.notes) : '',
    key, timeSignature,
    tempo: Number(raw.tempo) > 0 ? Number(raw.tempo) : 90,
    pickupBeats,
    swing: !!raw.swing,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    melody, chords, lyrics,
    arrangement: lh || rh ? { leftHand: lh || [], rightHand: rh || null, style: src.style || raw.arrangementStyle || 'manual' } : null,
    totalBeats,
  };
  return { song, errors, warnings };
}

const evToJson = (e, key) => {
  const o = { beat: e.beat, dur: e.dur };
  if (e.pitches.length === 1) o.pitch = midiToName(e.pitches[0], key);
  else o.pitches = e.pitches.map((p) => midiToName(p, key));
  if (e.lyric) o.lyric = e.lyric;
  return o;
};

/** Serialize internal song back to canonical portable JSON (pitch names, arrays). */
export function songToJson(song) {
  const o = {
    format: FORMAT_ID, version: FORMAT_VERSION, id: song.id, title: song.title,
    composer: song.composer || undefined, arranger: song.arranger || undefined, source: song.source || undefined,
    placeholder: song.placeholder || undefined, notes: song.notes || undefined,
    key: song.key, timeSignature: song.timeSignature, tempo: song.tempo, pickupBeats: song.pickupBeats || 0,
    swing: song.swing || undefined, tags: song.tags?.length ? song.tags : undefined,
    melody: song.melody.map((e) => evToJson(e, song.key)),
    chords: song.chords.map((c) => ({ beat: c.beat, dur: c.dur, symbol: c.symbol })),
  };
  if (song.lyrics?.length) o.lyricsText = lyricsToText(song.lyrics);
  if (song.arrangement) {
    o.arrangement = { style: song.arrangement.style, leftHand: song.arrangement.leftHand.map((e) => evToJson(e, song.key)) };
    if (song.arrangement.rightHand) o.arrangement.rightHand = song.arrangement.rightHand.map((e) => evToJson(e, song.key));
  }
  return JSON.parse(JSON.stringify(o));
}

/** Serialize events to the compact text notation (monophonic sequence of notes/chords, gaps -> rests). */
export function eventsToText(events, { timeSignature = '4/4', pickupBeats = 0, key = 'C', totalBeats = null } = {}) {
  const bpm = beatsPerMeasure(timeSignature);
  const evs = [...events].sort((a, b) => a.beat - b.beat);
  const barLines = (from, to) => { // bar boundaries strictly within (from, to]
    const out = [];
    let b = pickupBeats > 0 ? pickupBeats : bpm;
    while (b <= to + EPS) { if (b > from + EPS) out.push(b); b += bpm; }
    return out;
  };
  const toks = ['|'];
  let pos = 0, lastDur = null;
  const fmtDur = (d) => (d === lastDur ? '' : ':' + round(d));
  const emit = (str, dur) => {
    // split rests at bar lines; notes crossing bars are written whole (warning on re-parse)
    toks.push(str + fmtDur(dur)); lastDur = dur;
  };
  const advanceTo = (target) => {
    while (pos < target - EPS) {
      const nextBar = barLines(pos, target)[0];
      const stop = nextBar !== undefined && nextBar < target - EPS ? nextBar : target;
      emit('r', round(stop - pos));
      pos = stop;
      if (Math.abs(pos - (nextBar ?? -1)) < EPS) toks.push('|');
    }
  };
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.beat < pos - EPS) continue; // overlapping event (polyphony) not representable: skipped
    advanceTo(e.beat);
    const next = evs.slice(i + 1).find((x) => x.beat > e.beat + EPS);
    const dur = next ? Math.min(e.dur, round(next.beat - e.beat)) : e.dur;
    const sameOnset = evs.filter((x, j) => j > i && Math.abs(x.beat - e.beat) < EPS);
    const pitches = [...new Set([...e.pitches, ...sameOnset.flatMap((x) => x.pitches)])].sort((a, b) => a - b);
    i += sameOnset.length;
    emit(pitches.map((p) => midiToName(p, key)).join('+') + (e.lyric ? '' : ''), dur);
    if (e.lyric) toks[toks.length - 1] += `"${e.lyric}"`;
    const before = pos;
    pos = round(pos + dur);
    const bl = barLines(before, pos);
    if (bl.length && Math.abs(bl[bl.length - 1] - pos) < EPS) toks.push('|');
  }
  if (totalBeats != null) advanceTo(totalBeats);
  if (toks[toks.length - 1] !== '|') toks.push('|');
  // pretty: line break every 4 bars
  let out = '', bars = 0;
  for (const t of toks) {
    out += (out && !out.endsWith('\n') ? ' ' : '') + t;
    if (t === '|' && out.length > 2) { bars++; if (bars % 4 === 0) out += '\n'; }
  }
  return out.trim();
}

export function chordsToText(chords, { timeSignature = '4/4', pickupBeats = 0, totalBeats = 0 } = {}) {
  const bpm = beatsPerMeasure(timeSignature);
  const bars = [];
  const starts = [];
  if (pickupBeats > 0) starts.push([0, pickupBeats]);
  for (let b = pickupBeats; b < totalBeats - EPS; b += bpm) starts.push([b, b + bpm]);
  let prev = null;
  for (const [s, e] of starts) {
    const inBar = chords.filter((c) => c.beat >= s - EPS && c.beat < e - EPS);
    const toks = [];
    let pos = s;
    if (!inBar.length || inBar[0].beat > s + EPS) {
      // chord carried over from previous bar
      if (prev && prev.beat + prev.dur > s + EPS) { toks.push({ s: prev.symbol, d: (inBar[0]?.beat ?? e) - s }); }
      else toks.push({ s: 'N.C.', d: (inBar[0]?.beat ?? e) - s });
      pos = inBar[0]?.beat ?? e;
    }
    inBar.forEach((c, i) => {
      const end = inBar[i + 1]?.beat ?? e;
      toks.push({ s: c.symbol, d: end - c.beat });
    });
    prev = inBar.length ? inBar[inBar.length - 1] : prev;
    const even = toks.every((t) => Math.abs(t.d - (e - s) / toks.length) < EPS);
    bars.push(toks.map((t) => (even ? t.s : `${t.s}:${round(t.d)}`)).join(' '));
  }
  let out = '|';
  bars.forEach((b, i) => { out += ' ' + b + ' |'; if ((i + 1) % 4 === 0 && i < bars.length - 1) out += '\n|'; });
  return out;
}

/** Accept a single song, an array, or {songs:[...]} bundle. Returns {songs, errors, warnings}. */
export function parseImport(jsonText) {
  let data;
  try { data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText; }
  catch (e) { return { songs: [], errors: ['Invalid JSON: ' + e.message], warnings: [] }; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.songs) ? data.songs : [data];
  const songs = [], errors = [], warnings = [];
  list.forEach((raw, i) => {
    const r = normalizeSong(raw);
    const name = raw?.title || `song #${i + 1}`;
    r.errors.forEach((e) => errors.push(`${name}: ${e}`));
    r.warnings.forEach((w) => warnings.push(`${name}: ${w}`));
    if (r.song && !r.errors.length) songs.push(r.song);
  });
  return { songs, errors, warnings };
}

export function exportBundle(songs) {
  return { format: 'piano-song-bundle', version: FORMAT_VERSION, exported: new Date().toISOString(), songs: songs.map(songToJson) };
}

export function measureStarts(song) {
  const bpm = beatsPerMeasure(song.timeSignature);
  const out = [];
  if (song.pickupBeats > 0) out.push(0);
  for (let b = song.pickupBeats; b < song.totalBeats - EPS; b += bpm) out.push(round(b));
  return out;
}

export function chordAt(song, beat) {
  let cur = null;
  for (const c of song.chords) { if (c.beat <= beat + EPS && c.beat + c.dur > beat + EPS) cur = c; }
  return cur;
}
