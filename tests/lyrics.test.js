import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyricsText, parseLyricsField, lyricsToText, deriveLyrics, songSheet, followSequence, FollowAlong, chordMatch, requiredPcs, targetVoicing, chordToneNames } from '../js/lyrics.js';
import { normalizeSong, songToJson, parseImport } from '../js/songformat.js';
import { chordDisplay, mod12 } from '../js/theory.js';
import { SEED_SONGS } from '../js/seeds.js';
import { readFileSync } from 'node:fs';

test('lyricsText: inline chords, sections, blank lines, unknown bracket kept as text', () => {
  const r = parseLyricsText('[Verse 1]\nA[G]mazing [G7]grace, how [C]sweet\n\n\nThat saved a [Em]wretch like [D]me [D7]\n[x2] [N.C.]la');
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.lines[0], { type: 'section', label: 'Verse 1' });
  assert.deepEqual(r.lines[1].segs, [{ chord: null, text: 'A' }, { chord: 'G', text: 'mazing ' }, { chord: 'G7', text: 'grace, how ' }, { chord: 'C', text: 'sweet' }]);
  assert.equal(r.lines[2].type, 'blank');
  assert.equal(r.lines[3].segs.at(-1).chord, 'D7');
  assert.deepEqual(r.lines[4].segs, [{ chord: null, text: '[x2] ' }, { chord: 'N.C.', text: 'la' }]);
  // a line that is only a chord is a chord line, not a section
  assert.equal(parseLyricsText('[Am]').lines[0].type, 'line');
});

test('lyrics text roundtrip and array form', () => {
  const txt = '[Chorus]\nOh when the [F]saints go marching [C7]in\n\nWhen the [F]saints go [C7/E]marching [F]in';
  assert.equal(lyricsToText(parseLyricsText(txt).lines), txt);
  const arr = parseLyricsField(['[Chorus]', { section: 'Bridge' }, { segments: [{ chord: 'C', text: 'sweet ' }, { text: 'sound' }] }, '', 'x [Am]y']);
  assert.deepEqual(arr.errors, []);
  assert.deepEqual(arr.lines.map((l) => l.type), ['section', 'section', 'line', 'blank', 'line']);
  assert.equal(parseLyricsField([{ segments: [{ chord: 'Hm7', text: 'x' }] }]).errors.length, 1);
});

test('song JSON: optional lyrics field, backward compatible, survives export/import', () => {
  const old = normalizeSong({ title: 'Old', key: 'C', melodyText: '| C4:4 |', chordsText: '| C |' });
  assert.equal(old.song.lyrics, null);
  assert.equal('lyricsText' in songToJson(old.song), false);
  const s = normalizeSong(SEED_SONGS[0]).song;
  assert.ok(s.lyrics.length > 5);
  const again = parseImport(JSON.stringify(songToJson(s))).songs[0];
  assert.deepEqual(again.lyrics, s.lyrics);
  const viaArray = normalizeSong({ title: 'Arr', key: 'G', lyrics: ['A[G]mazing [G7]grace'] }).song;
  assert.equal(viaArray.lyrics[0].segs[1].chord, 'G');
  const lyricsOnly = normalizeSong({ title: 'Only lyrics', key: 'C', lyricsText: '[C]Hello [G]world' });
  assert.deepEqual(lyricsOnly.warnings, []);
  assert.equal(normalizeSong({ title: 'Bad', lyrics: 42 }).errors.length, 1);
});

test('example files with lyrics import cleanly', () => {
  for (const f of ['songs/example-lyrics-chords.json', 'songs/all-examples.bundle.json']) {
    const r = parseImport(readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
    assert.deepEqual(r.errors, [], f);
    assert.ok(r.songs.some((s) => s.lyrics?.length), f);
  }
});

test('seed lyrics chords follow the chord timeline (aligned)', () => {
  for (const raw of SEED_SONGS.filter((s) => s.lyricsText)) {
    const s = normalizeSong(raw).song;
    const seq = followSequence(s.lyrics).map((x) => x.symbol);
    // collapse repeated chords of the timeline: the sheet writes a chord where it changes
    const timeline = s.chords.map((c) => c.symbol).filter((c, i, a) => c !== a[i - 1]);
    assert.deepEqual(seq.slice(0, timeline.length), timeline, s.title);
  }
});

test('songs without lyrics: sheet derived from melody syllables or a chord chart', () => {
  const ag = normalizeSong({ ...SEED_SONGS[0], lyricsText: undefined }).song;
  const sh = songSheet(ag);
  assert.equal(sh.derived, true); assert.equal(sh.hasWords, true);
  assert.match(lyricsToText(sh.lines), /^A\[G\]mazing \[G7\]grace how \[C\]sweet/);
  const ode = songSheet(normalizeSong(SEED_SONGS[1]).song);
  assert.equal(ode.hasWords, false);
  assert.deepEqual(followSequence(ode.lines).map((x) => x.symbol).slice(0, 4), ['C', 'G', 'C', 'G']);
  assert.deepEqual(deriveLyrics({ melody: [], chords: [], timeSignature: '4/4' }), []);
});

test('tolerant chord matching: any inversion/voicing/octave, extra notes ok, 5th optional on 7ths', () => {
  assert.ok(chordMatch('A', [57, 61, 64]).ok); // root position
  assert.ok(chordMatch('A', [49, 64, 69]).ok); // 1st inversion, spread
  assert.ok(chordMatch('A/F#', [40, 57, 61, 64, 66]).ok); // slash bass not required, extra notes ok
  assert.ok(chordMatch('G7', [43, 59, 65]).ok); // no 5th
  assert.deepEqual(chordMatch('G7', [43, 50, 59]).missing, [5]); // the 7th is required
  assert.ok(!chordMatch('C', [57, 60, 64]).ok); // Am is not C (triads need all three)
  assert.ok(!chordMatch('Em', []).ok);
  assert.deepEqual(requiredPcs('C13').sort((a, b) => a - b), [0, 4, 9, 10]);
});

test('FollowAlong: advances on the played chord, needs a fresh key, manual next/back/restart', () => {
  const seq = followSequence(parseLyricsText('A[G]mazing [Em]grace [C/E]how [D7]sweet').lines);
  const ev = [];
  const f = new FollowAlong(seq, { onEvent: (e) => ev.push(e.type) });
  assert.equal(f.current.symbol, 'G');
  f.noteOn(55, 0); f.noteOn(59, 0.01); assert.equal(f.index, 0);
  f.noteOn(62, 0.02); assert.equal(f.index, 1); // G B D
  // still holding G B D: Em shares G and B, but nothing new yet
  f.check(0.1); assert.equal(f.index, 1);
  f.noteOn(52, 0.5); assert.equal(f.index, 2, 'E G B held + extra D = Em (extra notes ok)');
  // released everything, C/E played as root position C (any inversion accepted)
  [55, 59, 62, 52].forEach((n) => f.noteOff(n));
  f.noteOn(48, 1); f.noteOn(52, 1); f.noteOn(55, 1);
  assert.equal(f.index, 3);
  f.back(); assert.equal(f.current.symbol, 'C/E');
  f.next(); f.next(); assert.ok(f.done);
  assert.equal(ev.includes('finished'), false); // manual moves never count as finishing
  f.restart(); assert.equal(f.index, 0);
  f.goto(3);
  // broken chord (arpeggio) within the time window
  [48, 52, 55].forEach((n) => f.noteOff(n));
  f.noteOn(50, 2); f.noteOff(50); f.noteOn(54, 2.4); f.noteOff(54); assert.equal(f.index, 3); f.noteOn(60, 2.8);
  assert.ok(f.done); assert.ok(ev.includes('finished'));
});

test('FollowAlong: old struck notes expire, so a stale note does not complete the next chord', () => {
  const f = new FollowAlong(followSequence(parseLyricsText('[C]one [F]two').lines), { windowSec: 1 });
  f.noteOn(60, 0); f.noteOff(60);
  f.noteOn(64, 5); f.noteOff(64); f.noteOn(67, 5.2); assert.equal(f.index, 0); // C was 5 s ago
  f.noteOn(60, 5.4); assert.equal(f.index, 1);
});

test('target voicing and tone names', () => {
  assert.deepEqual(targetVoicing('C'), [48, 60, 64, 67]);
  assert.deepEqual(targetVoicing('D7/F#'), [54, 62, 66, 69, 72]); // F# bass, D7 above middle C
  assert.deepEqual(chordToneNames('A'), ['A', 'C#', 'E']);
  assert.deepEqual(chordToneNames('Bb', 'F'), ['Bb', 'D', 'F']);
});

test('inversion display modes: slash / name + label / name only', () => {
  assert.deepEqual(chordDisplay('A/C#', 'slash'), { main: 'A/C#', sub: '', text: 'A/C#' });
  assert.deepEqual(chordDisplay('A/C#', 'label'), { main: 'A', sub: '1st inversion', text: 'A (1st inversion)' });
  assert.deepEqual(chordDisplay('A/C#', 'base'), { main: 'A', sub: '', text: 'A' });
  assert.equal(chordDisplay('C/G', 'label').sub, '2nd inversion');
  assert.equal(chordDisplay('G7/F', 'label').sub, '3rd inversion');
  assert.equal(chordDisplay('A/F#', 'label').sub, 'over F#');
  assert.equal(chordDisplay('A/F#', 'base').main, 'A');
  assert.equal(chordDisplay('C6/9', 'base').main, 'C6/9');
  assert.equal(chordDisplay('Am', 'label', { rootLabel: true }).sub, 'root position');
  assert.equal(chordDisplay('N.C.', 'label').main, 'N.C.');
});

test('existing libraries: seed songs saved before the lyrics feature get the example lyrics (once, without touching others)', async () => {
  const { SongStore } = await import('../js/storage.js');
  const store = new SongStore();
  const oldSeed = normalizeSong({ ...SEED_SONGS[0], lyricsText: undefined }).song;
  const mine = normalizeSong({ title: 'Mine', key: 'C', melodyText: '| C4:4 |', chordsText: '| C |' }).song;
  await store.put(oldSeed); await store.put(mine);
  await store.init();
  const all = await store.all();
  assert.ok(all.find((s) => s.id === oldSeed.id).lyrics.length > 5);
  assert.equal(all.find((s) => s.id === mine.id).lyrics, null);
  assert.equal(all.length, 3); // + preloaded chords-only song
});

test('AI prompt documents lyricsText', async () => {
  const { AI_PROMPT } = await import('../js/prompt.js');
  assert.match(AI_PROMPT, /lyricsText/);
  assert.match(AI_PROMPT, /A\[G\]mazing/);
});
