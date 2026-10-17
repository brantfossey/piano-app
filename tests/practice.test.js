import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiHub, parseMidiMessage } from '../js/midi.js';
import { buildTargets, buildSteps, WaitEngine, SteadyEngine } from '../js/practice.js';
import { normalizeSong } from '../js/songformat.js';
import { SEED_SONGS } from '../js/seeds.js';
import { generateArrangement } from '../js/arranger.js';
import { buildDrill, checkChord, makeItem } from '../js/trainer.js';
import { detectChordName } from '../js/theory.js';

const ON = (n, v = 80, ch = 0) => [0x90 | ch, n, v];
const OFF = (n, ch = 0) => [0x80 | ch, n, 0];

test('MIDI byte parsing incl. running-status style note-off (vel 0), CC64, clock ignored', () => {
  assert.deepEqual(parseMidiMessage([0x90, 60, 100]), { type: 'noteon', channel: 1, note: 60, velocity: 100 });
  assert.equal(parseMidiMessage([0x90, 60, 0]).type, 'noteoff');
  assert.equal(parseMidiMessage([0x81, 60, 64]).type, 'noteoff');
  assert.equal(parseMidiMessage([0xb0, 64, 127]).controller, 64);
  assert.equal(parseMidiMessage([0xf8]), null);
  assert.equal(parseMidiMessage([0xfe]), null);
});

test('MidiHub: held vs sustained notes, live chord detection from simulated CVP input', () => {
  const hub = new MidiHub();
  const seen = [];
  hub.on((e) => seen.push(e.type));
  hub.handleBytes([0xfe]); // active sensing from Yamaha keyboards
  hub.handleBytes(ON(52)); hub.handleBytes(ON(55)); hub.handleBytes(ON(60));
  assert.deepEqual(hub.heldNotes(), [52, 55, 60]);
  assert.equal(detectChordName(hub.heldNotes()), 'C/E');
  hub.handleBytes([0xb0, 64, 127]);
  hub.handleBytes(OFF(52)); hub.handleBytes([0x90, 55, 0]);
  assert.deepEqual(hub.heldNotes(), [60]);
  assert.deepEqual(hub.soundingNotes(), [52, 55, 60]);
  hub.handleBytes([0xb0, 64, 0]);
  assert.deepEqual(hub.soundingNotes(), [60]);
  assert.deepEqual(seen.filter((t) => t !== 'pedal'), ['noteon', 'noteon', 'noteon', 'noteoff', 'noteoff']);
  hub.channelFilter = 2;
  hub.handleBytes(ON(70, 80, 0));
  assert.deepEqual(hub.heldNotes(), [60]);
  hub.handleBytes(ON(70, 80, 1));
  assert.deepEqual(hub.heldNotes(), [60, 70]);
});

function song(i) { return normalizeSong(SEED_SONGS[i]).song; }

test('wait-for-me: right hand advances only on correct notes, wrong notes counted', () => {
  const s = song(1); // Ode to Joy
  const { items } = buildTargets({ rightHand: s.melody, leftHand: s.arrangement.leftHand, chords: s.chords }, 'right');
  const steps = buildSteps(items);
  const events = [];
  const eng = new WaitEngine(steps, { onEvent: (e) => events.push(e.type) });
  let t = 0;
  const play = (n) => { t += 0.4; eng.noteOn(n, t); t += 0.2; eng.noteOff(n, t); };
  play(64); assert.equal(eng.index, 1);
  play(65); assert.equal(eng.index, 1, 'wrong note does not advance'); // expected E4 again
  play(64); assert.equal(eng.index, 2, 'repeated note must be re-pressed');
  for (const st of steps.slice(2)) play(st.exact[0]);
  assert.ok(eng.done);
  const r = eng.results();
  assert.equal(r.wrongNotes, 1);
  assert.equal(r.total, steps.length);
  assert.equal(r.cleanSteps, steps.length - 1);
  assert.ok(events.includes('finished'));
});

test('wait-for-me: both hands need simultaneous notes; slightly early next-step note is kept (grace)', () => {
  const s = song(1);
  const { items } = buildTargets({ rightHand: s.melody, leftHand: s.arrangement.leftHand, chords: s.chords }, 'both');
  const steps = buildSteps(items);
  assert.deepEqual(steps[0].exact.sort((a, b) => a - b), [48, 52, 55, 64]);
  const eng = new WaitEngine(steps);
  eng.noteOn(48, 1); eng.noteOn(52, 1.01); eng.noteOn(55, 1.02);
  assert.equal(eng.index, 0, 'LH alone is not enough');
  eng.noteOn(64, 1.05);
  assert.equal(eng.index, 1);
  // second step: E4 again (LH still held, not required) — release & re-press
  eng.noteOff(64); eng.noteOn(64, 1.6);
  assert.equal(eng.index, 2);
  // step 3 needs F4: press it, fine
  eng.noteOff(64); eng.noteOn(65, 2.0);
  assert.equal(eng.index, 3);
});

test('wait-for-me: melody + chord symbols accepts any LH voicing/inversion but rejects wrong chord', () => {
  const s = song(0); // Amazing Grace, G major
  const { items } = buildTargets({ rightHand: s.melody, chords: s.chords }, 'melody+chords');
  const steps = buildSteps(items);
  const eng = new WaitEngine(steps);
  eng.noteOn(62, 0); eng.noteOff(62); // pickup D4, no chord
  assert.equal(eng.index, 1);
  // bar 1: G4 + G chord. Play wrong chord (C/E) first
  eng.noteOn(52, 1); eng.noteOn(55, 1); eng.noteOn(60, 1); eng.noteOn(67, 1.1);
  assert.equal(eng.index, 1, 'C chord under G melody rejected');
  [52, 55, 60, 67].forEach((n) => eng.noteOff(n));
  // G chord in 2nd inversion D3 G3 B3
  eng.noteOn(50, 2); eng.noteOn(55, 2); eng.noteOn(59, 2); eng.noteOn(67, 2.02);
  assert.equal(eng.index, 2);
});

test('chords-only mode: G7 accepted without the 5th', () => {
  const steps = buildSteps(buildTargets({ chords: [{ beat: 0, dur: 4, symbol: 'G7' }] }, 'chords').items);
  const eng = new WaitEngine(steps);
  eng.noteOn(53, 0); eng.noteOn(59, 0);
  assert.equal(eng.index, 0);
  eng.noteOn(43, 0.05);
  assert.ok(eng.done);
});

test('steady tempo: timing scored perfect/good/ok, misses and extra notes counted', () => {
  const s = song(1);
  const { items } = buildTargets({ rightHand: s.melody }, 'right');
  const tempo = 120, spb = 0.5, start = 10;
  const evs = [];
  const eng = new SteadyEngine(items, { tempo, startTime: start, onEvent: (e) => evs.push(e) });
  const offsets = [0, 0.03, -0.09, 0.15, 0.2, 0.4 /* too late = miss + extra */];
  items.forEach((it, i) => {
    const t = start + it.beat * spb + (offsets[i] ?? 0.01);
    if (i === 7) { eng.update(t); return; } // skip a note entirely -> miss
    eng.noteOn(it.exact[0], t);
    eng.update(t);
  });
  eng.noteOn(30, start + 2); // stray
  eng.update(start + 1000);
  const r = eng.results();
  assert.equal(r.total, items.length);
  assert.equal(r.missed, 2);
  assert.equal(r.extra, 2);
  assert.equal(r.hit, items.length - 2);
  assert.ok(r.perfect >= items.length - 6);
  assert.equal(r.good, 1);
  assert.equal(r.ok, 2);
  assert.ok(r.score < 100 && r.score > 70, String(r.score));
  assert.ok(evs.some((e) => e.type === 'finished'));
});

test('steady tempo: chord symbol item hit when arpeggiated within window', () => {
  const items = buildTargets({ chords: [{ beat: 0, dur: 4, symbol: 'Am' }, { beat: 4, dur: 4, symbol: 'F' }] }, 'chords').items;
  const eng = new SteadyEngine(items, { tempo: 60, startTime: 0 });
  eng.noteOn(57, 0.02); eng.noteOn(60, 0.08); eng.noteOn(64, 0.12);
  eng.noteOn(53, 4.0); eng.noteOn(57, 4.01);
  eng.update(10);
  const r = eng.results();
  assert.equal(r.hit, 1); assert.equal(r.missed, 1);
});

test('play-along against generated arrangement (both hands) completes in wait mode', () => {
  const s = song(2);
  const arr = generateArrangement(s, { style: 'ragtime' });
  const steps = buildSteps(buildTargets({ rightHand: arr.rightHand, leftHand: arr.leftHand }, 'both').items);
  const eng = new WaitEngine(steps);
  let t = 0;
  for (const st of steps) {
    t += 0.3;
    for (const n of [...eng.held.keys()]) eng.noteOff(n);
    for (const n of st.exact) eng.noteOn(n, t);
  }
  assert.ok(eng.done, `stuck at ${eng.index}/${steps.length}`);
  assert.equal(eng.results().wrongNotes, 0);
});

test('chord trainer: inversions in all 12 keys, correct/partial/wrong-inversion feedback', () => {
  const drill = buildDrill({ qualities: ['maj', 'min', '7'], inversions: [0, 1, 2, 3], order: 'circle' });
  assert.equal(drill.length, 12 * (3 + 3 + 4));
  assert.equal(drill[0].rootPc, 0); assert.equal(drill[1 * 10].rootPc, 7);
  for (const item of drill) {
    assert.equal(checkChord(item, item.hint).status, 'correct', item.label);
    assert.equal(detectChordName(item.hint).replace(/\/.*/, '').length > 0, true);
  }
  const eb1 = makeItem(3, 'maj', 1); // Eb major 1st inversion: G Bb Eb
  assert.equal(checkChord(eb1, [55, 58]).status, 'partial');
  assert.equal(checkChord(eb1, [51, 55, 58]).status, 'wrong-inversion');
  assert.equal(checkChord(eb1, [55, 58, 63]).status, 'correct');
  assert.equal(checkChord(eb1, [43, 58, 63, 67]).status, 'correct', 'spread voicing OK if bass right');
  assert.equal(checkChord(eb1, [55, 58, 62]).status, 'wrong');
  const prog = buildDrill({ drill: 'progression', progression: 'I-IV-V-I', order: 'chromatic' });
  assert.equal(prog.length, 48);
  assert.match(prog[1].label, /F major — 2nd inversion/);
});
