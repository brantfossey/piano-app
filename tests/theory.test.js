import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePitch, detectChords, detectChordName, parseChordSymbol, spellMidi, voiceChord, parseDuration, parseKey } from '../js/theory.js';

test('pitch parsing', () => {
  assert.equal(parsePitch('C4'), 60);
  assert.equal(parsePitch('A0'), 21);
  assert.equal(parsePitch('C8'), 108);
  assert.equal(parsePitch('Bb3'), 58);
  assert.equal(parsePitch('F#5'), 78);
  assert.equal(parsePitch('Cb4'), 59);
  assert.equal(parsePitch('E#4'), 65);
  assert.equal(parsePitch('H4'), null);
  assert.equal(parsePitch(64), 64);
});

test('durations', () => {
  assert.equal(parseDuration('q'), 1);
  assert.equal(parseDuration('h.'), 3);
  assert.equal(parseDuration('e'), 0.5);
  assert.equal(parseDuration('1/3'), 1 / 3);
  assert.equal(parseDuration('0.75'), 0.75);
  assert.equal(parseDuration('qt'), 2 / 3);
  assert.equal(parseDuration('abc'), null);
});

test('chord detection: triads and inversions', () => {
  const n = (...ps) => ps.map(parsePitch);
  assert.equal(detectChordName(n('C4', 'E4', 'G4')), 'C');
  assert.equal(detectChords(n('E3', 'G3', 'C4'))[0].symbol, 'C/E');
  assert.equal(detectChords(n('E3', 'G3', 'C4'))[0].inversion, 1);
  assert.equal(detectChords(n('G3', 'C4', 'E4'))[0].inversion, 2);
  assert.equal(detectChordName(n('A3', 'C4', 'E4')), 'Am');
  assert.equal(detectChordName(n('B3', 'D4', 'F4')), 'Bdim');
  assert.equal(detectChordName(n('G2', 'B3', 'D4', 'F4')), 'G7');
  assert.equal(detectChordName(n('G2', 'B3', 'F4')), 'G7'); // 5th omitted
  assert.equal(detectChordName(n('D3', 'F3', 'A3', 'C4')), 'Dm7');
  assert.equal(detectChordName(n('C3', 'E3', 'G3', 'B3')), 'Cmaj7');
  assert.equal(detectChordName(n('C3', 'E3', 'G3', 'A3')), 'C6');
  assert.equal(detectChordName(n('A2', 'C3', 'E3', 'G3')), 'Am7');
  assert.equal(detectChordName(n('Eb3', 'G3', 'Bb3')), 'Eb');
  assert.equal(detectChordName(n('F#3', 'A#3', 'C#4')), 'F#');
  assert.equal(detectChordName(n('C3', 'F3', 'G3')), 'Csus4');
  assert.equal(detectChordName(n('C3', 'G3')), 'C5');
  assert.equal(detectChordName(n('B2', 'D3', 'F3', 'Ab3')), 'Bdim7');
  assert.equal(detectChordName(n('B2', 'D3', 'F3', 'A3')), 'Bm7b5');
  assert.equal(detectChordName(n('C2', 'C3', 'E4', 'G4', 'C5')), 'C'); // doublings
  assert.equal(detectChordName(n('F3', 'A3', 'C4', 'Eb4'), { key: 'Bb' }), 'F7');
  assert.equal(detectChordName(n('Bb2', 'D3', 'F3'), { key: 'F' }), 'Bb');
});

test('slash chords spell the bass from the root', () => {
  const n = (...ps) => ps.map(parsePitch);
  assert.equal(detectChordName(n('C#3', 'E3', 'A3')), 'A/C#');
  assert.equal(detectChordName(n('D3', 'G3', 'Bb3')), 'Gm/D');
  assert.equal(detectChordName(n('F#2', 'A3', 'C4', 'D4')), 'D7/F#');
  assert.equal(detectChordName(n('Ab2', 'C3', 'F3')), 'Fm/Ab');
});

test('chord symbol parsing', () => {
  assert.deepEqual(parseChordSymbol('G7/B').pcs.sort(), [2, 5, 7, 11].sort());
  assert.equal(parseChordSymbol('G7/B').bassPc, 11);
  assert.equal(parseChordSymbol('Bbmaj7').quality, 'maj7');
  assert.equal(parseChordSymbol('F#m7b5').quality, 'm7b5');
  assert.equal(parseChordSymbol('C6/9').quality, '69');
  assert.equal(parseChordSymbol('C6/E').bassPc, 4);
  assert.equal(parseChordSymbol('Ebm').quality, 'min');
  assert.equal(parseChordSymbol('N.C.').nc, true);
  assert.equal(parseChordSymbol('Xyz'), null);
  assert.equal(parseChordSymbol('Csus').quality, 'sus4');
  assert.equal(parseChordSymbol('C°7').quality, 'dim7');
});

test('spelling in keys', () => {
  assert.equal(spellMidi(66, 'G').name, 'F#4');
  assert.equal(spellMidi(70, 'F').name, 'Bb4');
  assert.equal(spellMidi(61, 'Dm').name, 'C#4'); // leading tone in D minor
  assert.equal(spellMidi(63, 'C').name, 'D#4');
  assert.equal(spellMidi(63, 'Bb').name, 'Eb4');
  assert.equal(spellMidi(59, 'Gb').name, 'Cb4');
  assert.equal(parseKey('Am').fifths, 0);
  assert.equal(parseKey('F#m').fifths, 3);
  assert.equal(parseKey('Eb').fifths, -3);
});

test('voicing inversions', () => {
  assert.deepEqual(voiceChord(0, 'maj', 0, 60), [60, 64, 67]);
  assert.deepEqual(voiceChord(0, 'maj', 1, 60), [64, 67, 72]);
  assert.deepEqual(voiceChord(0, 'maj', 2, 60), [67, 72, 76]);
  assert.deepEqual(voiceChord(7, '7', 3, 60), [65, 67, 71, 74]);
});
