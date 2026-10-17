// "Paste chord sheet" converter. The sample is a SHORT made-up text (not real song lyrics).
import test from 'node:test';
import assert from 'node:assert/strict';
import { convertChordSheet, simplifyChordSymbol, classifySheetLine, parseLyricsText, followSequence, isPlaceholderLyrics } from '../js/lyrics.js';
import { SEED_SONGS } from '../js/seeds.js';
import { normalizeSong } from '../js/songformat.js';

const SAMPLE = [
  '[Intro]',
  'C    G/B   Am7(#5)   F',
  '',
  '[Verse 1]',
  'C              G',
  'Paper boats go sailing',
  '    Am7          Bb7sus2',
  'down the little river',
  '',
  'Chorus:',
  '   C        Dm7',
  '   Sun is up',
].join('\n');

test('chord sheet: chords aligned to the syllable under them, sections and chord-only lines kept', () => {
  const r = convertChordSheet(SAMPLE);
  assert.equal(r.text, [
    '[Intro]',
    '[C] [G/B] [Am7] [F]',
    '',
    '[Verse 1]',
    '[C]Paper boats go [G]sailing',
    'down [Am7]the little r[Bb7sus4]iver',
    '',
    '[Chorus]',
    '[C]Sun is up [Dm7]',
  ].join('\n'));
  assert.deepEqual(r.replaced, [{ from: 'Am7(#5)', to: 'Am7', count: 1 }, { from: 'Bb7sus2', to: 'Bb7sus4', count: 1 }]);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.stats, { chordLines: 4, lyricLines: 3, sections: 3 });
  // round-trips through the app's own lyricsText parser without warnings
  const p = parseLyricsText(r.text);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(followSequence(p.lines).map((x) => x.symbol), ['C', 'G/B', 'Am7', 'F', 'C', 'G', 'Am7', 'Bb7sus4', 'C', 'Dm7']);
});

test('chord sheet: simplify off keeps unsupported chords as written', () => {
  const r = convertChordSheet(SAMPLE, { simplify: false });
  assert.match(r.text, /\[Am7\(#5\)\]/);
  assert.match(r.text, /r\[Bb7sus2\]iver/);
  assert.deepEqual(r.replaced, []);
  assert.deepEqual(r.unknown.sort(), ['Am7(#5)', 'Bb7sus2']);
});

test('chord sheet: mid-word chord, chord past line end, tabs, UG [ch] markup, label + chords, repeat marks', () => {
  assert.equal(convertChordSheet('G      D\nla lalala').text, '[G]la lala[D]la');
  assert.equal(convertChordSheet('Em          A7\nhum hum').text, '[Em]hum hum [A7]');
  assert.equal(convertChordSheet('[ch]C[/ch]  [ch]F[/ch]\nonetwothree').text, '[C]one[F]twothree');
  assert.equal(convertChordSheet('C\tF\nabcdefgh', { tabWidth: 4 }).text, '[C]abcd[F]efgh');
  assert.equal(convertChordSheet('Intro: | Am | F  x2 |').text, '[Intro]\n[Am] [F] x2');
  assert.equal(convertChordSheet('[Solo]\nN.C.  E7').text, '[Solo]\n[N.C.] [E7]');
  // plain lyric lines without chords stay as they are; extra blank lines collapse
  assert.equal(convertChordSheet('just words here\n\n\n\nA   D\nmore words').text, 'just words here\n\n[A]more [D]words');
});

test('line classification: lyrics that look a bit like chords are not chord lines', () => {
  assert.equal(classifySheetLine('Am I dreaming').kind, 'lyric');
  assert.equal(classifySheetLine('Bad dog, Dad').kind, 'lyric');
  assert.equal(classifySheetLine('  Cmaj7   D/F#  Gsus4 (x2)').kind, 'chords');
  assert.equal(classifySheetLine('[Pre-Chorus]').kind, 'section');
  assert.equal(classifySheetLine('[Am]').kind, 'chords');
  assert.equal(convertChordSheet('[G]   [C]\nsing a little').text, '[G]sing a [C]little');
  assert.equal(classifySheetLine('Bridge').kind, 'section');
  assert.equal(classifySheetLine('Break my fall').kind, 'lyric');
});

test('simplifyChordSymbol', () => {
  assert.deepEqual(simplifyChordSymbol('Am7(#5)'), { symbol: 'Am7', replaced: true });
  assert.deepEqual(simplifyChordSymbol('Bb7sus2'), { symbol: 'Bb7sus4', replaced: true });
  assert.deepEqual(simplifyChordSymbol('C#m7b5/G'), { symbol: 'C#m7b5/G', replaced: false });
  assert.equal(simplifyChordSymbol('Cmaj7#11').symbol, 'Cmaj7');
  assert.equal(simplifyChordSymbol('Dm11').symbol, 'Dm7');
  assert.equal(simplifyChordSymbol('G9sus4/D').symbol, 'G7sus4/D');
  assert.equal(simplifyChordSymbol('(Em)').symbol, 'Em');
  assert.equal(simplifyChordSymbol('Hello'), null);
});

test('chords-only preloaded song counts as a placeholder that a paste may replace', () => {
  const seed = SEED_SONGS.find((s) => s.id === 'nothings-gonna-change-my-love-for-you');
  assert.ok(isPlaceholderLyrics(seed.lyricsText));
  assert.ok(isPlaceholderLyrics(normalizeSong(seed).song.lyrics));
  assert.equal(isPlaceholderLyrics(convertChordSheet(SAMPLE).text), false);
  // the converted sheet replaces the placeholder lyrics on the song
  const { song } = normalizeSong({ ...seed, lyricsText: convertChordSheet(SAMPLE).text });
  assert.equal(song.lyrics[0].label, 'Intro');
  assert.equal(isPlaceholderLyrics(song.lyrics), false);
});
