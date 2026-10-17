import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSong, parseNoteText, parseChordText, songToJson, eventsToText, chordsToText, parseImport, exportBundle } from '../js/songformat.js';
import { SEED_SONGS } from '../js/seeds.js';
import { generateArrangement, STYLES, LH_PATTERNS } from '../js/arranger.js';
import { parseChordSymbol, mod12 } from '../js/theory.js';

test('note text parsing with bar checks, rests, chords, lyrics', () => {
  const r = parseNoteText('| D4:1 | G4:2 B4:e G4 | C4+E4+G4:h r:q B3 |', { timeSignature: '3/4', pickupBeats: 1 });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1); // last bar 4 beats in 3/4
  assert.equal(r.events.length, 6);
  assert.deepEqual(r.events[4], { beat: 4, dur: 2, pitches: [60, 64, 67] });
  assert.equal(r.events[5].beat, 7);
  const ly = parseNoteText('G4:1"grace"');
  assert.equal(ly.events[0].lyric, 'grace');
});

test('chord text parsing', () => {
  const r = parseChordText('| N.C. | G | C G/B | Am:2 D7:1 | % |', { timeSignature: '3/4', pickupBeats: 1 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.chords.map((c) => [c.beat, c.dur, c.symbol]), [[1, 3, 'G'], [4, 1.5, 'C'], [5.5, 1.5, 'G/B'], [7, 2, 'Am'], [9, 1, 'D7'], [10, 3, 'D7']]);
});

test('all seed songs normalize without errors or bar warnings', () => {
  for (const s of SEED_SONGS) {
    const { song, errors, warnings } = normalizeSong(s);
    assert.deepEqual(errors, [], s.title);
    assert.deepEqual(warnings, [], s.title);
    if (!s.placeholder || s.melodyText) assert.ok(song.melody.length > 10);
    if (s.melodyText) assert.ok(song.chords.length > 4);
    assert.equal(song.placeholder, true);
  }
});

test('JSON roundtrip: text form -> canonical arrays -> normalize gives identical model', () => {
  for (const s of SEED_SONGS) {
    const a = normalizeSong(s).song;
    const json = songToJson(a);
    const b = normalizeSong(json).song;
    assert.deepEqual(b.melody, a.melody);
    assert.deepEqual(b.chords, a.chords);
    assert.deepEqual(b.arrangement, a.arrangement);
    assert.equal(b.totalBeats, a.totalBeats);
  }
});

test('text serializer roundtrip', () => {
  for (const s of SEED_SONGS) {
    const a = normalizeSong(s).song;
    const opts = { timeSignature: a.timeSignature, pickupBeats: a.pickupBeats, key: a.key, totalBeats: a.totalBeats };
    const txt = eventsToText(a.melody, opts);
    const re = parseNoteText(txt, { ...opts, label: 'm' });
    assert.deepEqual(re.errors, []);
    assert.deepEqual(re.events, a.melody, s.title + '\n' + txt);
    const ct = chordsToText(a.chords, opts);
    const rc = parseChordText(ct, opts);
    assert.deepEqual(rc.chords, a.chords, ct);
  }
});

test('import bundle / array / single, with error reporting', () => {
  const bundle = exportBundle(SEED_SONGS.map((s) => normalizeSong(s).song));
  assert.equal(parseImport(JSON.stringify(bundle)).songs.length, SEED_SONGS.length);
  assert.equal(parseImport(JSON.stringify(SEED_SONGS)).songs.length, SEED_SONGS.length);
  const bad = parseImport(JSON.stringify({ title: 'Bad', melodyText: 'Q9:1', chordsText: '| Hmaj |' }));
  assert.equal(bad.songs.length, 0);
  assert.ok(bad.errors.length >= 2);
  assert.ok(parseImport('{not json').errors[0].startsWith('Invalid JSON'));
});

test('arrangement generator: every style x pattern yields chord-consistent, non-overlapping hands', () => {
  for (const s of SEED_SONGS.filter((x) => x.melodyText)) {
    const song = normalizeSong(s).song;
    for (const style of Object.keys(STYLES)) for (const pat of Object.keys(LH_PATTERNS)) {
      const arr = generateArrangement(song, { style, lhPattern: pat });
      assert.ok(arr.leftHand.length > 0, `${style}/${pat}`);
      assert.equal(arr.rightHand.length, song.melody.length);
      for (let i = 1; i < arr.leftHand.length; i++) {
        const p = arr.leftHand[i - 1], c = arr.leftHand[i];
        assert.ok(p.beat + p.dur <= c.beat + 1e-6, `LH overlap ${style}/${pat} at ${c.beat}`);
      }
      // RH: melody stays the top note
      arr.rightHand.forEach((e, i) => assert.equal(Math.max(...e.pitches), Math.max(...song.melody[i].pitches)));
      // LH notes are chord tones (except walk-up approach notes)
      for (const e of arr.leftHand) {
        const ch = song.chords.find((c) => c.beat <= e.beat + 1e-6 && c.beat + c.dur > e.beat + 1e-6);
        assert.ok(ch, `LH note without chord at ${e.beat}`);
        const p = parseChordSymbol(ch.symbol);
        const nonChord = e.pitches.filter((n) => !p.pcs.includes(mod12(n)));
        assert.ok(nonChord.length <= 1, `${style}/${pat} ${ch.symbol} beat ${e.beat}: ${e.pitches}`);
      }
      // ranges
      for (const e of arr.leftHand) for (const n of e.pitches) assert.ok(n >= 28 && n <= 67, `LH range ${n}`);
      // hands don't cross: RH fill notes stay above LH notes sounding at the same time
      for (const r of arr.rightHand) {
        const l = arr.leftHand.find((x) => x.beat <= r.beat + 1e-6 && x.beat + x.dur > r.beat + 1e-6);
        if (l && r.pitches.length > 1) assert.ok(Math.min(...r.pitches) > Math.max(...l.pitches) || Math.min(...r.pitches) === Math.max(...song.melody.find(m=>m.beat===r.beat).pitches));
      }
    }
  }
});

test('stride pattern shape in 4/4: bass on 1 & 3, chords on 2 & 4', () => {
  const song = normalizeSong({ title: 't', timeSignature: '4/4', melodyText: 'C5:4 | C5:4', chordsText: '| C | F |' }).song;
  const arr = generateArrangement(song, { style: 'ragtime' });
  const bar1 = arr.leftHand.filter((e) => e.beat < 4);
  assert.deepEqual(bar1.map((e) => e.beat), [0, 1, 2, 3]);
  assert.ok(bar1[0].pitches.length === 2 && bar1[0].pitches[1] - bar1[0].pitches[0] === 12, 'octave bass');
  assert.equal(bar1[1].pitches.length, 3);
  assert.deepEqual(new Set(bar1[1].pitches.map(mod12)), new Set([0, 4, 7]));
});

test('broken pattern is eighth notes; block is held', () => {
  const song = normalizeSong({ title: 't', timeSignature: '4/4', melodyText: 'E5:4 | F5:4', chordsText: '| C | F |' }).song;
  const br = generateArrangement(song, { style: 'pop', lhPattern: 'broken' });
  assert.equal(br.leftHand.filter((e) => e.beat < 4).length, 8);
  assert.ok(br.leftHand.every((e) => e.dur === 0.5 && e.pitches.length === 1));
  const bl = generateArrangement(song, { style: 'pop', lhPattern: 'block' });
  assert.equal(bl.leftHand.length, 2);
  assert.equal(bl.leftHand[0].dur, 4);
  // RH fills on downbeats in pop
  assert.equal(br.rightHand[0].pitches.length, 3);
});
