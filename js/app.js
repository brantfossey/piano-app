// App glue: UI wiring for MIDI, live display, play-along, editor, library and chord trainer.
import { MidiHub, COMPUTER_KEYS, now } from './midi.js';
import { AudioEngine } from './audio.js';
import { PianoKeyboard } from './keyboard.js';
import { ScoreView } from './staff.js';
import { SongStore } from './storage.js';
function setMidiStatus(msg) { const el = document.getElementById('midiStatus'); el.textContent = msg; el.title = msg; }
import { detectChords, midiToName, spellMidi, parseChordSymbol, voiceChord, beatsPerMeasure, QUALITY_BY_ID, ROOT_NAMES, parseDuration, parsePitchClass, chordDisplay, INVERSION_DISPLAY_MODES } from './theory.js';
import { songSheet, followSequence, FollowAlong, targetVoicing, chordToneNames, lyricsToText, convertChordSheet, isPlaceholderLyrics } from './lyrics.js';
import { normalizeSong, songToJson, eventsToText, chordsToText, parseImport, exportBundle, parseNoteText, measureStarts } from './songformat.js';
import { generateArrangement, STYLES, LH_PATTERNS } from './arranger.js';
import { buildTargets, buildSteps, WaitEngine, SteadyEngine, HAND_MODES } from './practice.js';
import { buildDrill, checkChord, recordStat, PROGRESSIONS, DRILL_QUALITIES } from './trainer.js';
import { AI_PROMPT } from './prompt.js';

const $ = (id) => document.getElementById(id);
const hub = new MidiHub();
const audio = new AudioEngine();
const store = new SongStore();
const settings = Object.assign({ tab: 'practice', style: 'pop', pattern: 'auto', hands: 'melody+chords', mode: 'wait',
  kbRange: window.innerWidth >= 700 ? '88' : '49', invDisplay: 'slash', lyricsSize: 'm' }, JSON.parse(localStorage.getItem('cfp-settings') || '{}'));
if (!INVERSION_DISPLAY_MODES[settings.invDisplay]) settings.invDisplay = 'slash';
const saveSettings = () => localStorage.setItem('cfp-settings', JSON.stringify(settings));
let songs = [];
let currentSongId = settings.songId || null;
const EPS = 1e-6;

// ---------------- keyboard + live display ----------------
const KB_RANGES = { 88: [21, 108], 61: [36, 96], 49: [36, 84] };
const keyboard = new PianoKeyboard($('keyboard'), {
  low: KB_RANGES[settings.kbRange][0], high: KB_RANGES[settings.kbRange][1],
  onNoteOn: (n, v) => { audio.note(n, 0.8, 0.7); hub.noteOn(n, v, now(), 'screen'); },
  onNoteOff: (n) => hub.noteOff(n, now(), 'screen'),
  // any highlight change (targets, hints, wrong/good flashes) is mirrored on the live staff
  onChange: (kind) => { if (kind !== 'played') scheduleLive(); },
});
$('kbRange').value = settings.kbRange;
$('kbRange').onchange = (e) => { settings.kbRange = e.target.value; saveSettings(); keyboard.setRange(...KB_RANGES[e.target.value]); };
const setKbCollapsed = (c) => { document.querySelector('footer.live').classList.toggle('collapsed', c); document.body.classList.toggle('kb-collapsed', c); $('kbToggle').textContent = c ? 'show keys' : 'hide keys'; };
setKbCollapsed(!!settings.kbCollapsed);
$('kbToggle').onclick = () => { settings.kbCollapsed = !settings.kbCollapsed; saveSettings(); setKbCollapsed(settings.kbCollapsed); };
const liveStaff = new ScoreView($('liveStaff'), { compact: true, measuresPerRow: 1 });
// keep the page content clear of the fixed footer (its height depends on screen width and the hide-keys toggle)
const footerEl = document.querySelector('footer.live');
const fitFooter = () => { document.body.style.paddingBottom = footerEl.offsetHeight + 12 + 'px'; };
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitFooter).observe(footerEl);
window.addEventListener('resize', fitFooter);

// chord-name display setting (slash / name + inversion label / name only)
Object.entries(INVERSION_DISPLAY_MODES).forEach(([k, v]) => $('invDisplay').add(new Option(v, k)));
$('invDisplay').value = settings.invDisplay;
const fmtChord = (c, opts) => chordDisplay(c, settings.invDisplay, opts);
const chordLabel = (sym) => fmtChord(sym);
/** HTML for a chord: big name + small inversion text (when the setting asks for it). */
function chordHtml(c, opts) {
  const d = fmtChord(c, opts);
  return escapeHtml(d.main) + (d.sub ? `<span class="invsub">${escapeHtml(d.sub)}</span>` : '');
}
$('invDisplay').onchange = (e) => {
  settings.invDisplay = e.target.value; saveSettings();
  updateLive(); renderPracticeScore(); editor.renderPreview(); lyricsView.render(true);
  if (trainer.running && trainer.items[trainer.idx]) trainer.showSymbol(trainer.items[trainer.idx]);
};

function contextKey() { return currentSong()?.key || 'C'; }
function updateLive() {
  const held = hub.heldNotes();
  const sounding = hub.soundingNotes();
  keyboard.set('played', sounding);
  const key = contextKey();
  // the live staff shows every highlighted note (pressed, target, hint …) with the same state classes as the keys
  const shown = keyboard.highlighted();
  liveStaff.render({ key, timeSignature: '4/4', totalBeats: 4,
    rh: shown.filter((n) => n >= 60).length ? [{ beat: 0, dur: 4, pitches: shown.filter((n) => n >= 60) }] : [],
    lh: shown.filter((n) => n < 60).length ? [{ beat: 0, dur: 4, pitches: shown.filter((n) => n < 60) }] : [],
    noteClass: (m) => keyboard.classesOf(m) });
  const det = detectChords(held.length >= 2 ? held : sounding, { key });
  const d = det[0] ? fmtChord(det[0], { rootLabel: true }) : null;
  $('liveChord').textContent = d?.main || (held.length ? midiToName(held[0], key) : '—');
  $('liveInv').textContent = d?.sub || '';
  const alts = [...new Set(det.slice(1).map((x) => fmtChord(x).main))].filter((x) => x !== d?.main);
  $('liveAlt').textContent = alts.length ? 'also: ' + alts.join(', ') : '';
  $('liveNotes').textContent = held.map((n) => spellMidi(n, key).name).join(' ');
  $('livePedal').textContent = hub.pedal ? 'Pedal ⬇' : '';
}
let liveRaf = 0;
function scheduleLive() { if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; updateLive(); }); }
hub.on((ev) => {
  if (ev.type === 'noteon' && ev.source === 'midi' && $('monitorMidi').checked) audio.note(ev.note, 0.8, ev.velocity / 127);
  scheduleLive();
  if (ev.type === 'noteon') { practice.noteOn(ev.note, ev.time); trainer.onNote(); stepEntry.noteOn(ev.note); lyricsView.noteOn(ev.note, ev.time); }
  if (ev.type === 'noteoff') { practice.noteOff(ev.note, ev.time); trainer.onNote(); stepEntry.noteOff(ev.note); lyricsView.noteOff(ev.note); }
  if (ev.type === 'devices') refreshDevices();
});

// computer keyboard
const downKeys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if ($('tab-lyrics').classList.contains('active') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    if (e.key === 'ArrowRight') lyricsView.next(); else lyricsView.back();
    e.preventDefault(); return;
  }
  const k = e.key.toLowerCase();
  if (k in COMPUTER_KEYS && !downKeys.has(k)) { downKeys.add(k); const n = 48 + COMPUTER_KEYS[k]; audio.note(n, 0.6, 0.7); hub.noteOn(n, 90, now(), 'computer'); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (downKeys.has(k)) { downKeys.delete(k); hub.noteOff(48 + COMPUTER_KEYS[k], now(), 'computer'); }
});
window.addEventListener('blur', () => { downKeys.clear(); });

// ---------------- MIDI device picker ----------------
for (let c = 1; c <= 16; c++) $('midiChannel').add(new Option(String(c), String(c)));
$('midiChannel').onchange = (e) => { hub.channelFilter = +e.target.value; };
$('volume').oninput = (e) => audio.setVolume(+e.target.value);
$('midiConnect').onclick = async () => {
  audio.ensure();
  try {
    await hub.requestAccess();
    refreshDevices();
    if (!hub.inputs().length) $('midiStatus').textContent = 'MIDI ready — no devices found (check cable / USB driver, then reconnect)';
  } catch (e) { $('midiStatus').textContent = e.message; }
};
function refreshDevices() {
  const iSel = $('midiInput'), oSel = $('midiOutput');
  const ins = hub.inputs(), outs = hub.outputs();
  const keepI = hub.input?.id || settings.midiIn, keepO = hub.output?.id || settings.midiOut;
  iSel.innerHTML = '<option value="">— none —</option>'; oSel.innerHTML = '<option value="">Built-in synth</option>';
  ins.forEach((i) => iSel.add(new Option(i.name + (i.manufacturer ? ` (${i.manufacturer})` : ''), i.id)));
  outs.forEach((o) => oSel.add(new Option(o.name, o.id)));
  let pick = ins.find((i) => i.id === keepI) || ins.find((i) => /cvp|clavinova|yamaha|digital piano|usb/i.test(i.name)) || ins[0];
  if (pick && hub.input?.id !== pick.id) hub.selectInput(pick.id);
  iSel.value = hub.input?.id || '';
  if (keepO && outs.find((o) => o.id === keepO)) { hub.selectOutput(keepO); oSel.value = keepO; audio.midiOut = hub.output; audio.useMidiOut = true; }
  setMidiStatus(hub.input ? `Listening: ${hub.input.name}` : 'No MIDI input selected');
}
$('midiInput').onchange = (e) => { hub.selectInput(e.target.value); settings.midiIn = e.target.value; saveSettings(); setMidiStatus(hub.input ? `Listening: ${hub.input.name}` : 'No MIDI input selected'); };
$('midiOutput').onchange = (e) => {
  hub.selectOutput(e.target.value); settings.midiOut = e.target.value; saveSettings();
  audio.midiOut = hub.output; audio.useMidiOut = !!hub.output;
};
if (!MidiHub.supported()) $('midiStatus').textContent = 'Web MIDI not supported here — use Chrome/Edge. On-screen & computer keys still work.';
else if (settings.midiIn) $('midiConnect').click(); // auto-reconnect (browser may prompt once)

// ---------------- tabs ----------------
document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  settings.tab = name; saveSettings();
  lyricsView.setActive(name === 'lyrics');
  if (name === 'practice') renderPracticeScore();
  if (name === 'library') editor.renderPreview();
}

// ---------------- songs ----------------
function currentSong() { return songs.find((s) => s.id === currentSongId) || songs[0] || null; }
async function reloadSongs(selectId) {
  songs = await store.all();
  if (selectId) currentSongId = selectId;
  if (!songs.find((s) => s.id === currentSongId)) currentSongId = songs[0]?.id || null;
  settings.songId = currentSongId; saveSettings();
  $('pSong').innerHTML = '';
  songs.forEach((s) => $('pSong').add(new Option(s.title, s.id)));
  $('pSong').value = currentSongId || '';
  $('lSong').innerHTML = '';
  songs.forEach((s) => $('lSong').add(new Option(s.title + (s.lyrics ? '' : ' (no lyrics)'), s.id)));
  $('lSong').value = currentSongId || '';
  library.renderList();
  lyricsView.render();
}

// ---------------- practice ----------------
Object.entries(STYLES).forEach(([k, v]) => $('pStyle').add(new Option(v.name, k)));
Object.entries(LH_PATTERNS).forEach(([k, v]) => $('pPattern').add(new Option(v, k)));
Object.entries(HAND_MODES).forEach(([k, v]) => $('pHands').add(new Option(v, k)));
$('pStyle').value = settings.style; $('pPattern').value = settings.pattern; $('pHands').value = settings.hands; $('pMode').value = settings.mode;
const pScore = new ScoreView($('pScore'), { onBeatClick: (b) => {
  const s = currentSong(); if (!s) return;
  const ms = measureStarts(s); let idx = 0;
  ms.forEach((m, i) => { if (m <= b + EPS) idx = i; });
  $('pFrom').value = idx + (s.pickupBeats > 0 ? 0 : 1);
  pScore.setStartMark(ms[idx]);
} });

function currentParts() {
  const s = currentSong(); if (!s) return null;
  let arr;
  if ($('pArrSource').value === 'own' && s.arrangement) arr = { leftHand: s.arrangement.leftHand, rightHand: s.arrangement.rightHand || s.melody, style: s.arrangement.style };
  else arr = generateArrangement(s, { style: $('pStyle').value, lhPattern: $('pPattern').value, rhFill: $('pFill').checked });
  const hands = $('pHands').value;
  // chord-symbol modes: right hand reads the plain melody, left hand supplies the harmony
  const rh = $('pMelodyOnly').checked || hands === 'melody+chords' || hands === 'chords' ? s.melody : arr.rightHand;
  return { song: s, rightHand: rh, leftHand: arr.leftHand, chords: s.chords, arr };
}
function renderPracticeScore() {
  const p = currentParts();
  if (!p) { $('pScore').textContent = 'No songs in the library.'; return; }
  const s = p.song;
  const hands = $('pHands').value;
  pScore.render({ key: s.key, timeSignature: s.timeSignature, pickupBeats: s.pickupBeats, totalBeats: s.totalBeats,
    rh: p.rightHand, lh: hands === 'melody+chords' || hands === 'chords' ? [] : p.leftHand,
    chords: s.chords, showLyrics: true, chordLabel });
  $('pArrSource').querySelector('[value=own]').disabled = !s.arrangement;
  if (!s.arrangement && $('pArrSource').value === 'own') $('pArrSource').value = 'generated';
  const gen = $('pArrSource').value === 'generated';
  $('pStyle').disabled = $('pPattern').disabled = $('pFill').disabled = !gen;
  $('pSaveArr').disabled = !gen;
  $('pTempo').value = settings.tempoFor?.[s.id] || s.tempo;
  const ph = s.placeholder ? ' ⚠️ This is a simplified placeholder song.' : '';
  if (!practice.running) $('pStatus').textContent = `${s.title} — key ${s.key}, ${s.timeSignature}, ${s.tempo} bpm.${ph}`;
}
['pSong', 'pArrSource', 'pStyle', 'pPattern', 'pFill', 'pHands', 'pMelodyOnly', 'pAuto', 'pMode'].forEach((id) => $(id).addEventListener('change', () => {
  if (id === 'pSong') { currentSongId = $('pSong').value; settings.songId = currentSongId; $('pFrom').value = ''; $('pTo').value = ''; pScore.setStartMark(0); }
  settings.style = $('pStyle').value; settings.pattern = $('pPattern').value; settings.hands = $('pHands').value; settings.mode = $('pMode').value; saveSettings();
  practice.stop(); renderPracticeScore();
}));
$('pTempo').onchange = () => { const s = currentSong(); if (!s) return; (settings.tempoFor ||= {})[s.id] = +$('pTempo').value; saveSettings(); };
$('pSaveArr').onclick = async () => {
  const p = currentParts(); if (!p) return;
  p.song.arrangement = { leftHand: p.arr.leftHand, rightHand: p.arr.rightHand, style: `${p.arr.style}/${p.arr.lhPattern}` };
  await store.put(p.song); await reloadSongs(p.song.id);
  $('pArrSource').value = 'own'; renderPracticeScore();
  $('pStatus').textContent = 'Arrangement saved into the song (Arrangement → “Song’s own”). It is included when you export.';
};

const practice = {
  running: false, engine: null, timers: [], raf: 0,
  range() {
    const s = currentSong();
    const ms = measureStarts(s);
    const off = s.pickupBeats > 0 ? 0 : 1; // bar numbers: pickup = 0
    const fromIdx = $('pFrom').value === '' ? 0 : Math.max(0, Math.min(ms.length - 1, +$('pFrom').value - off));
    const toIdx = $('pTo').value ? Math.max(fromIdx, Math.min(ms.length - 1, +$('pTo').value - off)) : ms.length - 1;
    return { fromBeat: ms[fromIdx], toBeat: toIdx + 1 < ms.length ? ms[toIdx + 1] : s.totalBeats };
  },
  start() {
    this.stop();
    audio.ensure();
    const p = currentParts(); if (!p) return;
    const s = p.song;
    const { fromBeat, toBeat } = this.range();
    const hands = $('pHands').value;
    const { items, accompaniment } = buildTargets(p, hands, { fromBeat, toBeat });
    if (!items.length) { $('pStatus').textContent = 'Nothing to play in this part/range.'; return; }
    this.p = p; this.items = items; this.accomp = $('pAuto').checked ? accompaniment : []; this.fromBeat = fromBeat; this.toBeat = toBeat;
    this.tempo = +$('pTempo').value || s.tempo; this.spb = 60 / this.tempo;
    this.running = true; pScore.clearMarks();
    this.mode = $('pMode').value;
    if (this.mode === 'wait') this.startWait(); else this.startSteady();
  },
  stop() {
    this.running = false; this.engine = null;
    this.timers.forEach(clearTimeout); this.timers = [];
    if (this.sched) clearInterval(this.sched); this.sched = null;
    cancelAnimationFrame(this.raf);
    keyboard.set('target', []); keyboard.set('hint', []); keyboard.set('wrong', []); keyboard.set('good', []);
    pScore.setCursor(null);
  },
  // ----- wait mode -----
  startWait() {
    const steps = buildSteps(this.items);
    this.steps = steps;
    const eng = new WaitEngine(steps, { onEvent: (e) => this.onWaitEvent(e) });
    this.engine = eng;
    eng.onEvent({ type: 'step', index: 0, step: steps[0] });
    $('pStatus').textContent = 'Waiting for you… play the highlighted notes.';
  },
  onWaitEvent(e) {
    if (e.type === 'wrong') { this.flashWrong(e.note); return; }
    if (e.type === 'advance' || e.type === 'step') {
      const prev = this.steps[e.index - 1];
      if (prev) prev.items.forEach((it) => pScore.mark(it.beat, it.hand === 'C' ? 'R' : it.hand, 'hit'));
      if (e.type === 'advance') this.playAccomp(prev ? prev.beat : this.fromBeat, e.step ? e.step.beat : this.toBeat);
      if (e.step) this.showStep(e.step);
    }
    if (e.type === 'finished') {
      const r = e.results;
      keyboard.set('target', []); keyboard.set('hint', []);
      $('pStatus').innerHTML = `<b>Finished!</b> ${r.cleanSteps}/${r.total} steps clean (${r.accuracy}%), ${r.wrongNotes} wrong notes, avg ${r.avgStepSec}s per step.`;
      this.running = false;
      if ($('pLoop').checked) this.timers.push(setTimeout(() => this.start(), 1200));
    }
  },
  showStep(step) {
    pScore.setCursor(step.beat);
    const hint = $('pHints').checked;
    keyboard.set('target', hint ? step.exact : []);
    let chordHint = [];
    if (hint && step.chordReqs.length) {
      const r = step.chordReqs[0];
      const pc = parseChordSymbol(r.symbol);
      chordHint = voiceChord(pc.rootPc, pc.quality, 0, 48).filter((n) => n < 60);
    }
    keyboard.set('hint', chordHint);
    const label = step.chordReqs.length ? ` Chord: <b>${step.chordReqs.map((r) => escapeHtml(fmtChord(r.symbol).text)).join(', ')}</b>` : '';
    const notes = step.exact.length ? ' Notes: ' + step.exact.map((n) => spellMidi(n, this.p.song.key).name).join(' ') : '';
    $('pStatus').innerHTML = `Step ${this.engine.index + 1}/${this.steps.length}.${notes}${label}`;
  },
  flashWrong(n) {
    keyboard.set('wrong', [n]);
    this.timers.push(setTimeout(() => keyboard.set('wrong', []), 350));
  },
  playAccomp(fromB, toB) {
    if (!this.accomp.length) return;
    const t0 = now() + 0.02;
    for (const a of this.accomp) {
      if (a.beat >= fromB - EPS && a.beat < toB - EPS) audio.chord(a.pitches, a.dur * this.spb * 0.95, 0.55, t0 + (a.beat - fromB) * this.spb);
    }
  },
  // ----- steady mode -----
  startSteady() {
    const s = this.p.song;
    const bpm = beatsPerMeasure(s.timeSignature);
    const countIn = +$('pCountIn').value * bpm;
    const t0 = now() + 0.4 + countIn * this.spb - this.fromBeat * this.spb; // time of beat 0
    this.t0 = t0;
    this.engine = new SteadyEngine(this.items, { tempo: this.tempo, startTime: t0, onEvent: (e) => this.onSteadyEvent(e) });
    this.scheduleTimeline(t0, this.fromBeat - countIn, this.toBeat, $('pMetro').checked, this.accomp);
    const loop = () => {
      if (!this.running) return;
      const t = now();
      const beat = (t - t0) / this.spb;
      this.engine.update(t);
      if (beat >= this.fromBeat) pScore.setCursor(Math.min(beat, this.toBeat - 0.01));
      else $('pStatus').textContent = `Count-in… ${Math.ceil(this.fromBeat - beat)}`;
      if ($('pHints').checked) {
        const upcoming = this.items.filter((it) => it.beat >= beat - 0.05 && it.beat < beat + 0.6);
        keyboard.set('target', upcoming.flatMap((it) => it.exact));
      }
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  onSteadyEvent(e) {
    if (e.type === 'hit') { pScore.mark(e.item.beat, e.item.kind === 'chord' ? 'R' : e.item.hand, 'hit'); this.liveScore(); }
    if (e.type === 'miss') { pScore.mark(e.item.beat, e.item.kind === 'chord' ? 'R' : e.item.hand, 'miss'); this.liveScore(); }
    if (e.type === 'extra') this.flashWrong(e.note);
    if (e.type === 'finished') {
      const r = e.results;
      this.running = false;
      if (this.sched) clearInterval(this.sched);
      keyboard.set('target', []);
      $('pStatus').innerHTML = `<b>Score ${r.score}</b> — hit ${r.hit}/${r.total} (${r.accuracy}%), missed ${r.missed}, extra ${r.extra}. ` +
        `Timing: ${r.perfect} perfect, ${r.good} good, ${r.ok} ok; average ${r.meanAbsOffsetMs} ms off, ${r.tendency} (${r.meanOffsetMs > 0 ? '+' : ''}${r.meanOffsetMs} ms).`;
      pScore.setCursor(null);
      if ($('pLoop').checked) this.timers.push(setTimeout(() => this.start(), 1500));
    }
  },
  liveScore() {
    const r = this.engine.results();
    $('pStatus').textContent = `Playing… hit ${r.hit}, missed ${r.missed}, extra ${r.extra}`;
  },
  /** Lookahead scheduler for metronome clicks + accompaniment. */
  scheduleTimeline(t0, fromBeat, toBeat, metro, events) {
    const s = this.p ? this.p.song : currentSong();
    const bpm = beatsPerMeasure(s.timeSignature);
    const pickup = s.pickupBeats || 0;
    let nextClick = Math.ceil(fromBeat - EPS);
    const queue = events.filter((a) => a.beat >= fromBeat - EPS && a.beat < toBeat - EPS).sort((a, b) => a.beat - b.beat);
    let qi = 0;
    const tick = () => {
      const horizon = (now() + 0.15 - t0) / this.spb;
      while (metro && nextClick < toBeat - EPS && nextClick <= horizon) {
        const inBar = ((nextClick - pickup) % bpm + bpm) % bpm;
        audio.click(Math.abs(inBar) < EPS, t0 + nextClick * this.spb);
        nextClick += 1;
      }
      while (qi < queue.length && queue[qi].beat <= horizon) {
        const a = queue[qi++];
        audio.chord(a.pitches, a.dur * this.spb * 0.95, 0.55, t0 + a.beat * this.spb);
      }
    };
    tick();
    this.sched = setInterval(tick, 25);
  },
  listen() {
    this.stop(); audio.ensure();
    const p = currentParts(); if (!p) return;
    this.p = p;
    const { fromBeat, toBeat } = this.range();
    this.tempo = +$('pTempo').value || p.song.tempo; this.spb = 60 / this.tempo;
    const evs = [...p.rightHand, ...p.leftHand].map((e) => ({ beat: e.beat, dur: e.dur, pitches: e.pitches }));
    const t0 = now() + 0.3 - fromBeat * this.spb;
    this.running = true; this.mode = 'listen';
    this.scheduleTimeline(t0, fromBeat, toBeat, false, evs);
    $('pStatus').textContent = 'Listening to the arrangement…';
    const loop = () => {
      if (!this.running) return;
      const beat = (now() - t0) / this.spb;
      if (beat > toBeat) { this.stop(); $('pStatus').textContent = 'Done.'; return; }
      pScore.setCursor(beat);
      const sounding = evs.filter((e) => e.beat <= beat && e.beat + e.dur > beat).flatMap((e) => e.pitches);
      keyboard.set('target', sounding);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },
  noteOn(n, t) {
    if (!this.running || !this.engine) return;
    if (!document.getElementById('tab-practice').classList.contains('active')) return;
    this.engine.noteOn(n, t);
  },
  noteOff(n, t) { if (this.running && this.engine) this.engine.noteOff(n, t); },
};
$('pStart').onclick = () => practice.start();
$('pStop').onclick = () => { practice.stop(); $('pStatus').textContent = 'Stopped.'; };
$('pListen').onclick = () => practice.listen();

// ---------------- lyrics & chords (follow-along) ----------------
$('lSize').value = settings.lyricsSize;
$('lSheet').className = 'panel lyricsheet size-' + settings.lyricsSize;
$('lSize').onchange = (e) => { settings.lyricsSize = e.target.value; saveSettings(); $('lSheet').className = 'panel lyricsheet size-' + e.target.value; };
$('lSong').onchange = () => {
  currentSongId = $('lSong').value; settings.songId = currentSongId; saveSettings();
  $('pSong').value = currentSongId; library.renderList(); lyricsView.render(); renderPracticeScore();
};
const lyricsView = {
  songId: null, sheet: null, seq: [], engine: null, running: false, active: false, chordEls: [], feedback: '',
  /** Build the chord sheet for the current song (keeps the position when only the display changed). */
  render(keepPosition = false) {
    const s = currentSong();
    const sheetEl = $('lSheet');
    if (!s) { sheetEl.textContent = 'No songs in the library.'; this.seq = []; this.engine = null; this.update(); return; }
    const same = s.id === this.songId;
    const sheet = songSheet(s);
    const seq = followSequence(sheet.lines);
    const keep = (keepPosition || same) && this.engine && this.engine.seq.length === seq.length ? this.engine.index : 0;
    if (!same) this.running = false;
    this.songId = s.id; this.sheet = sheet; this.seq = seq;
    this.engine = new FollowAlong(seq, { onEvent: (e) => this.onEvent(e) });
    this.engine.index = keep;
    $('lSource').textContent = sheet.derived
      ? (sheet.hasWords ? 'No lyrics field in this song: showing the melody’s syllables.' : 'No lyrics in this song: showing the chord chart.')
      : `${s.key} · ${seq.length} chords` + (isPlaceholderLyrics(sheet.lines) ? ' · chords only — paste your chord sheet in Library & Editor to add the words' : '');
    // DOM: lines of words; every word is a non-breaking group of [chord over text] pieces
    sheetEl.innerHTML = '';
    this.chordEls = [];
    let ci = 0;
    sheet.lines.forEach((line) => {
      if (line.type === 'blank') { sheetEl.appendChild(Object.assign(document.createElement('div'), { className: 'lblank' })); return; }
      if (line.type === 'section') { sheetEl.appendChild(Object.assign(document.createElement('div'), { className: 'lsection', textContent: line.label })); return; }
      const ln = document.createElement('div'); ln.className = 'lline';
      let word = null;
      const newWord = () => { word = document.createElement('span'); word.className = 'lw'; ln.appendChild(word); };
      newWord();
      line.segs.forEach((seg) => {
        // split the segment text into words; the chord sits on the first piece
        const pieces = seg.text.match(/\S*\s*/g).filter(Boolean);
        if (!pieces.length) pieces.push('');
        pieces.forEach((txt, pi) => {
          const piece = document.createElement('span'); piece.className = 'lp';
          const ch = document.createElement('span'); ch.className = 'lc';
          if (pi === 0 && seg.chord) {
            ch.innerHTML = chordHtml(seg.chord);
            if (seg.chord !== 'N.C.') {
              const idx = ci++;
              ch.classList.add('target'); ch.dataset.idx = idx; ch.title = 'Jump here';
              ch.onclick = () => { if (!this.running) this.start(idx); else this.engine.goto(idx); };
              this.chordEls[idx] = ch;
            } else ch.classList.add('nc');
          } else ch.innerHTML = '&nbsp;';
          const tx = document.createElement('span'); tx.className = 'lt'; tx.textContent = txt || (seg.chord ? '\u00a0\u00a0' : '');
          piece.append(ch, tx); word.appendChild(piece);
          if (/\s$/.test(txt)) newWord();
        });
      });
      sheetEl.appendChild(ln);
    });
    if (!sheet.lines.length) sheetEl.innerHTML = '<p class="small">This song has no chords or lyrics yet. Add them in Library &amp; Editor (“Optional lyrics &amp; chords”).</p>';
    this.update(false);
  },
  setActive(on) {
    if (!on && this.active) keyboard.set('target', []);
    this.active = on; this.highlightKeys();
  },
  start(idx = 0) {
    audio.ensure();
    if (!this.engine || !this.seq.length) { $('lFeedback').textContent = 'This song has no chords to follow.'; return; }
    this.running = true; this.feedback = ''; this.engine.matched = 0;
    this.engine.goto(idx);
  },
  stop() { this.running = false; this.feedback = ''; this.update(false); },
  next() { if (!this.engine) return; if (!this.running) return this.start(Math.min(this.engine.index + 1, this.seq.length - 1)); this.feedback = ''; this.engine.next(); },
  back() { if (!this.engine) return; if (!this.running) return this.start(Math.max(this.engine.index - 1, 0)); this.feedback = ''; this.engine.back(); },
  restart() { if (!this.engine) return; if (!this.running) return this.start(0); this.feedback = ''; this.engine.restart(); },
  noteOn(n, t) {
    if (!this.engine) return;
    if (this.running && this.active) this.engine.noteOn(n, t); else this.engine.held.add(n);
  },
  noteOff(n) { if (this.engine) this.engine.noteOff(n); },
  onEvent(e) {
    if (!this.running) { return; }
    if (e.type === 'advance') { this.feedback = `<span class="ok">✔ ${escapeHtml(fmtChord(e.played.symbol).text)}</span>`; audio.ensure(); }
    if (e.type === 'partial') {
      if (this.engine.struck.size < 3) return; // only comment once a real attempt (3+ new keys) was made
      const names = chordToneNames(this.engine.current.parsed, currentSong()?.key);
      const missing = e.missing.map((pc) => names.find((n) => parsePitchClass(n) === pc) || ROOT_NAMES[pc]);
      this.feedback = `<span class="warn">Not yet: missing ${escapeHtml(missing.join(', '))}</span>`;
      this.update(false); return;
    }
    if (e.type === 'finished') this.feedback = '<span class="ok">🎉 End of the song. Press Restart to go again.</span>';
    this.update(true);
  },
  /** Refresh highlights, the big display panel and the keyboard/staff targets. */
  update(scroll = true) {
    const eng = this.engine, idx = eng ? eng.index : 0, cur = this.running && eng ? eng.current : null;
    this.chordEls.forEach((el, i) => {
      if (!el) return;
      el.classList.toggle('current', !!cur && i === idx);
      el.classList.toggle('done', this.running && i < idx);
    });
    $('lSheet').querySelectorAll('.lline.currentline').forEach((x) => x.classList.remove('currentline'));
    const curEl = cur ? this.chordEls[idx] : null;
    if (curEl) {
      curEl.closest('.lline').classList.add('currentline');
      if (scroll) {
        const box = $('lSheet'), r = curEl.getBoundingClientRect(), br = box.getBoundingClientRect();
        if (r.top < br.top + 10 || r.bottom > br.bottom - 10) box.scrollTo({ top: box.scrollTop + r.top - br.top - box.clientHeight / 3, behavior: 'smooth' });
      }
    }
    const s = currentSong();
    const sec = cur ? [...this.sheet.lines.slice(0, cur.line)].reverse().find((l) => l.type === 'section') : null;
    $('lContext').textContent = cur ? `Chord ${idx + 1} of ${this.seq.length}${sec ? ' · ' + sec.label : ''}` : (s ? s.title : '');
    if (cur) {
      $('lTarget').textContent = cur.text.trim() ? '“' + cur.text.trim() + '”' : '\u00a0';
      $('lSymbol').innerHTML = chordHtml(cur.symbol);
      $('lTones').textContent = 'Notes: ' + chordToneNames(cur.parsed, s?.key).join(' – ') + ' · any inversion or voicing';
      const up = this.seq.slice(idx + 1, idx + 4).map((x) => fmtChord(x.symbol).text);
      $('lUpcoming').textContent = up.length ? 'then: ' + up.join(' → ') : 'last chord';
    } else {
      const done = this.running && eng && eng.done;
      $('lTarget').textContent = done ? 'Finished' : this.seq.length ? 'Press Follow along' : 'No chords';
      $('lSymbol').innerHTML = !done && this.seq.length ? chordHtml(this.seq[0].symbol) : '';
      $('lTones').textContent = !done && this.seq.length ? 'First chord. Play it when the song starts.' : '';
      $('lUpcoming').textContent = '';
    }
    $('lFeedback').innerHTML = this.feedback || (cur ? 'Play it!' : '');
    $('lStart').textContent = this.running ? '▶ Following…' : '▶ Follow along';
    this.highlightKeys();
  },
  /** Target notes of the current chord on the keyboard (and thereby on the live staff). */
  highlightKeys() {
    if (!this.active) return;
    const cur = this.running && this.engine ? this.engine.current : null;
    keyboard.set('target', cur && $('lHints').checked ? targetVoicing(cur.parsed) : []);
  },
};
$('lStart').onclick = () => lyricsView.start(lyricsView.engine && !lyricsView.engine.done ? lyricsView.engine.index : 0);
$('lStop').onclick = () => lyricsView.stop();
$('lNext').onclick = () => lyricsView.next();
$('lBack').onclick = () => lyricsView.back();
$('lRestart').onclick = () => lyricsView.restart();
$('lHints').onchange = () => lyricsView.highlightKeys();

// ---------------- library ----------------
const library = {
  renderList() {
    const q = $('libSearch').value.toLowerCase();
    const ul = $('libList'); ul.innerHTML = '';
    songs.filter((s) => !q || (s.title + ' ' + s.composer + ' ' + s.tags.join(' ')).toLowerCase().includes(q)).forEach((s) => {
      const li = document.createElement('li');
      li.innerHTML = `<b></b><span class="small"></span>`;
      li.firstChild.textContent = s.title;
      li.lastChild.textContent = ` ${s.key} · ${s.timeSignature}${s.placeholder ? ' · placeholder' : ''}${s.arrangement ? ' · LH' : ''}${s.lyrics ? ' · lyrics' : ''}`;
      li.classList.toggle('active', s.id === currentSongId);
      li.onclick = () => { currentSongId = s.id; settings.songId = s.id; saveSettings(); $('pSong').value = s.id; this.renderList(); editor.load(s); };
      ul.appendChild(li);
    });
    $('libInfo').textContent = `${songs.length} songs · stored in ${store.mode}`;
  },
  download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async importText(text) {
    const r = parseImport(text);
    for (const s of r.songs) await store.put(s);
    await reloadSongs(r.songs[0]?.id);
    if (r.songs[0]) editor.load(currentSong());
    const msg = [`Imported ${r.songs.length} song(s).`, ...r.errors.map((e) => '❌ ' + e), ...r.warnings.map((w) => '⚠️ ' + w)];
    $('eProblems').innerHTML = msg.map((m) => `<div>${escapeHtml(m)}</div>`).join('');
  },
};
$('libSearch').oninput = () => library.renderList();
$('libNew').onclick = async () => {
  const { song } = normalizeSong({ title: 'New song', key: 'C', timeSignature: '4/4', tempo: 90, melodyText: '| C4:1 D4 E4 F4 | G4:4 |', chordsText: '| C | C |' });
  await store.put(song); await reloadSongs(song.id); editor.load(currentSong());
};
$('libDup').onclick = async () => {
  const s = currentSong(); if (!s) return;
  const j = songToJson(s); j.id = undefined; j.title = s.title + ' (copy)';
  const { song } = normalizeSong(j); await store.put(song); await reloadSongs(song.id); editor.load(currentSong());
};
$('libDel').onclick = async () => {
  const s = currentSong(); if (!s || !confirm(`Delete “${s.title}”? (Export first if you want a backup.)`)) return;
  await store.remove(s.id); await reloadSongs(); editor.load(currentSong());
};
$('libImport').onchange = async (e) => {
  for (const f of e.target.files) await library.importText(await f.text());
  e.target.value = '';
};
$('libPaste').onclick = () => { $('pasteText').value = ''; $('pasteDlg').showModal(); };
$('pasteDlg').addEventListener('close', () => { if ($('pasteDlg').returnValue === 'ok' && $('pasteText').value.trim()) library.importText($('pasteText').value); });
$('libExport').onclick = () => { const s = currentSong(); if (s) library.download(slugify(s.title) + '.json', songToJson(s)); };
$('libExportAll').onclick = () => library.download('piano-songs-' + new Date().toISOString().slice(0, 10) + '.json', exportBundle(songs));
$('libSeeds').onclick = async () => { await store.restoreSeeds(); await reloadSongs(currentSongId); };
$('libPrompt').onclick = async () => {
  try { await navigator.clipboard.writeText(AI_PROMPT); $('libInfo').textContent = 'AI prompt copied to clipboard. Paste it to your assistant together with the sheet music.'; }
  catch { $('pasteText').value = AI_PROMPT; $('pasteDlg').showModal(); }
};

// ---------------- editor ----------------
const eScore = new ScoreView($('eScore'));
const editor = {
  song: null, dirty: false,
  load(s) {
    this.song = s; if (!s) return;
    const o = { timeSignature: s.timeSignature, pickupBeats: s.pickupBeats, key: s.key, totalBeats: s.totalBeats };
    $('eTitle').value = s.title; $('eComposer').value = s.composer; $('eKey').value = s.key; $('eTime').value = s.timeSignature;
    $('eTempo').value = s.tempo; $('ePickup').value = s.pickupBeats; $('ePlaceholder').checked = s.placeholder; $('eSource').value = s.source;
    $('eMelody').value = eventsToText(s.melody, o);
    $('eChords').value = chordsToText(s.chords, o);
    $('eLH').value = s.arrangement ? eventsToText(s.arrangement.leftHand, o) : '';
    $('eRH').value = s.arrangement?.rightHand ? eventsToText(s.arrangement.rightHand, o) : '';
    $('eArrDetails').open = !!s.arrangement;
    $('eLyrics').value = s.lyrics ? lyricsToText(s.lyrics) : '';
    $('eLyrDetails').open = !!s.lyrics;
    this.dirty = false; $('eMsg').textContent = '';
    this.renderPreview();
  },
  raw() {
    const r = {
      id: this.song?.id, title: $('eTitle').value, composer: $('eComposer').value, key: $('eKey').value.trim() || 'C',
      timeSignature: $('eTime').value.trim() || '4/4', tempo: +$('eTempo').value || 90, pickupBeats: +$('ePickup').value || 0,
      placeholder: $('ePlaceholder').checked, source: $('eSource').value, tags: this.song?.tags || [], notes: this.song?.notes || '',
      melodyText: $('eMelody').value, chordsText: $('eChords').value,
    };
    if ($('eLyrics').value.trim()) r.lyricsText = $('eLyrics').value;
    if ($('eLH').value.trim() || $('eRH').value.trim()) {
      r.arrangement = { style: this.song?.arrangement?.style || 'manual' };
      if ($('eLH').value.trim()) r.arrangement.leftHandText = $('eLH').value;
      if ($('eRH').value.trim()) r.arrangement.rightHandText = $('eRH').value;
    }
    return r;
  },
  renderPreview() {
    const { song, errors, warnings } = normalizeSong(this.raw());
    $('eProblems').innerHTML = [...errors.map((e) => '❌ ' + e), ...warnings.map((w) => '⚠️ ' + w)].map((m) => `<div>${escapeHtml(m)}</div>`).join('');
    if (song) eScore.render({ key: song.key, timeSignature: song.timeSignature, pickupBeats: song.pickupBeats, totalBeats: song.totalBeats,
      rh: song.arrangement?.rightHand || song.melody, lh: song.arrangement?.leftHand || [], chords: song.chords, showLyrics: true, chordLabel });
    return { song, errors };
  },
  async save() {
    const { song, errors } = this.renderPreview();
    if (errors.length) { $('eMsg').textContent = 'Fix the errors first.'; return; }
    await store.put(song); await reloadSongs(song.id); this.song = currentSong();
    this.dirty = false; $('eMsg').textContent = 'Saved ✔'; renderPracticeScore();
  },
};
let previewTimer = 0;
['eTitle', 'eComposer', 'eKey', 'eTime', 'eTempo', 'ePickup', 'ePlaceholder', 'eSource', 'eMelody', 'eChords', 'eLH', 'eRH', 'eLyrics'].forEach((id) =>
  $(id).addEventListener('input', () => { editor.dirty = true; $('eMsg').textContent = 'unsaved changes'; clearTimeout(previewTimer); previewTimer = setTimeout(() => editor.renderPreview(), 300); }));
$('eSave').onclick = () => editor.save();
// "Paste chord sheet": convert a monospace chord sheet into lyricsText and save it on this song (IndexedDB, this browser only)
$('eConvertSheet').onclick = async () => {
  const msg = $('eConvertMsg');
  const pasted = $('ePasteSheet').value;
  if (!pasted.trim()) { msg.textContent = 'Paste a chord sheet into the box first.'; return; }
  const r = convertChordSheet(pasted, { simplify: $('eSimplify').checked });
  if (!r.text.trim() || !r.stats.chordLines) { msg.textContent = 'No chord lines found in the pasted text.'; return; }
  const cur = $('eLyrics').value;
  if (cur.trim() && !isPlaceholderLyrics(cur) && cur.trim() !== r.text.trim() && !confirm('Replace the lyrics & chords already in this song?')) return;
  $('eLyrics').value = r.text;
  $('eLyrDetails').open = true;
  await editor.save();
  const parts = [`Converted ${r.stats.chordLines} chord line(s), ${r.stats.lyricLines} lyric line(s)` + (editor.dirty ? ' — fix the errors, then Save.' : ' and saved in this browser.')];
  if (r.replaced.length) parts.push('Simplified: ' + r.replaced.map((x) => `${x.from} → ${x.to}`).join(', ') + '.');
  if (r.unknown.length) parts.push('Not recognised (kept as text): ' + r.unknown.join(', ') + '.');
  msg.textContent = parts.join(' ');
};
$('eRevert').onclick = () => editor.load(currentSong());
$('ePractice').onclick = async () => { if (editor.dirty) await editor.save(); $('pSong').value = currentSongId; showTab('practice'); };
$('eShowJson').onclick = () => {
  const w = $('eJsonWrap'); w.hidden = !w.hidden;
  if (!w.hidden) { const { song } = normalizeSong(editor.raw()); $('eJson').value = JSON.stringify(song ? songToJson(song) : editor.raw(), null, 2); }
};
$('eApplyJson').onclick = () => {
  const r = parseImport($('eJson').value);
  if (!r.songs.length) { $('eProblems').innerHTML = r.errors.map((e) => `<div>❌ ${escapeHtml(e)}</div>`).join(''); return; }
  const s = r.songs[0]; s.id = editor.song?.id || s.id; editor.load(s); editor.song = s; editor.dirty = true; $('eMsg').textContent = 'applied — press Save';
};

// step entry
const stepEntry = {
  pending: new Set(), dur: 1,
  active() { return $('sOn').checked && $('tab-library').classList.contains('active'); },
  textarea() { return { melody: $('eMelody'), chords: $('eChords'), lh: $('eLH'), rh: $('eRH') }[$('sTarget').value]; },
  duration() { return this.dur * ($('sDot').checked ? 1.5 : 1); },
  noteOn(n) { if (this.active()) this.pending.add(n); },
  noteOff() {
    if (!this.active() || hub.heldNotes().length || !this.pending.size) return;
    const notes = [...this.pending].sort((a, b) => a - b); this.pending.clear();
    const key = $('eKey').value || 'C';
    if ($('sTarget').value === 'chords') {
      const sym = detectChords(notes, { key })[0]?.symbol;
      if (sym && !sym.includes('+')) this.append(`${sym}:${this.duration()}`);
      return;
    }
    if ($('sTarget').value === 'melody' && notes.length > 1) notes.splice(0, notes.length - 1, notes[notes.length - 1]); // melody: top note
    this.append(notes.map((m) => spellMidi(m, key).name).join('+') + ':' + this.duration());
  },
  append(tok) {
    const ta = this.textarea();
    if ($('sTarget').value !== 'melody' && $('sTarget').value !== 'chords') $('eArrDetails').open = true;
    ta.value = (ta.value.replace(/\s+$/, '') + ' ' + tok).trim();
    if ($('sAutoBar').checked) this.autoBar(ta);
    ta.dispatchEvent(new Event('input'));
    ta.scrollTop = ta.scrollHeight;
  },
  autoBar(ta) {
    const ts = $('eTime').value || '4/4', pickup = +$('ePickup').value || 0, bpm = beatsPerMeasure(ts);
    let beats;
    if (ta === $('eChords')) {
      // sum of explicit durations since last bar line
      const last = ta.value.split('|').pop();
      const sum = last.trim().split(/\s+/).filter(Boolean).reduce((a, t) => a + (parseDuration(t.split(':')[1] || '') || 0), 0);
      const barsBefore = ta.value.split('|').length - (ta.value.trim().startsWith('|') ? 2 : 1);
      const target = barsBefore === 0 && pickup > 0 ? pickup : bpm;
      if (Math.abs(sum - target) < EPS) ta.value += ' |';
      return;
    }
    beats = parseNoteText(ta.value, { timeSignature: ts, pickupBeats: pickup }).totalBeats;
    const rel = beats - pickup;
    if (beats > EPS && (Math.abs(beats - pickup) < EPS || (rel > EPS && Math.abs(rel / bpm - Math.round(rel / bpm)) < EPS))) {
      if (!/\|\s*$/.test(ta.value)) ta.value += ' |';
    }
  },
};
$('sDur').querySelectorAll('button').forEach((b) => b.onclick = () => {
  $('sDur').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); stepEntry.dur = +b.dataset.d;
});
$('sRest').onclick = () => stepEntry.append($('sTarget').value === 'chords' ? `N.C.:${stepEntry.duration()}` : `r:${stepEntry.duration()}`);
$('sBar').onclick = () => { const ta = stepEntry.textarea(); ta.value = ta.value.trimEnd() + ' |'; ta.dispatchEvent(new Event('input')); };
$('sUndo').onclick = () => {
  const ta = stepEntry.textarea();
  ta.value = ta.value.trimEnd().replace(/\s*\|\s*$/, '').replace(/\s*\S+$/, '');
  ta.dispatchEvent(new Event('input'));
};

// ---------------- trainer ----------------
const tStats = JSON.parse(localStorage.getItem('cfp-trainer-stats') || '{}');
const tSel = Object.assign({ roots: [...Array(12).keys()], quals: ['maj', 'min'], invs: [0, 1, 2] }, JSON.parse(localStorage.getItem('cfp-trainer-sel') || '{}'));
function chips(container, items, selected, onChange) {
  container.innerHTML = '';
  items.forEach(([val, label]) => {
    const b = document.createElement('button'); b.className = 'chip' + (selected.includes(val) ? ' on' : ''); b.textContent = label;
    b.onclick = () => { const i = selected.indexOf(val); if (i >= 0) selected.splice(i, 1); else selected.push(val); b.classList.toggle('on'); onChange(); };
    container.appendChild(b);
  });
}
const saveSel = () => localStorage.setItem('cfp-trainer-sel', JSON.stringify(tSel));
const renderChips = () => {
  chips($('tRoots'), ROOT_NAMES.map((n, i) => [i, n]), tSel.roots, saveSel);
  chips($('tQuals'), DRILL_QUALITIES.map((q) => [q, (q === 'maj' ? 'major' : QUALITY_BY_ID[q].sym) ]), tSel.quals, saveSel);
  chips($('tInvs'), [[0, 'root'], [1, '1st'], [2, '2nd'], [3, '3rd (7th chords)']], tSel.invs, saveSel);
};
renderChips();
$('tAllRoots').onclick = () => { tSel.roots.splice(0, 99, ...Array(12).keys()); saveSel(); renderChips(); };
$('tNoRoots').onclick = () => { tSel.roots.splice(0, 99); saveSel(); renderChips(); };
Object.entries(PROGRESSIONS).forEach(([k, v]) => $('tProg').add(new Option(v.name, k)));
$('tDrill').onchange = () => {
  const prog = $('tDrill').value === 'progression';
  $('tProgWrap').hidden = !prog; $('tQualRow').hidden = prog; $('tInvRow').hidden = prog;
};
const trainer = {
  items: [], idx: 0, running: false, mistakes: 0, startT: 0, streak: 0, clean: 0, done: 0, needNew: false,
  start() {
    audio.ensure();
    this.items = buildDrill({ drill: $('tDrill').value, roots: tSel.roots, qualities: tSel.quals, inversions: tSel.invs, order: $('tOrder').value,
      progression: $('tProg').value, requireInversion: $('tReqInv').checked });
    if (!this.items.length) { $('tTarget').textContent = 'Select at least one key, chord type and inversion.'; return; }
    this.idx = 0; this.running = true; this.streak = 0; this.clean = 0; this.done = 0; this.times = [];
    this.show();
  },
  stop() { this.running = false; clearTimeout(this.timer); keyboard.set('hint', []); keyboard.set('good', []); $('tTarget').textContent = 'Stopped'; $('tFeedback').textContent = ''; },
  show() {
    const it = this.items[this.idx];
    this.mistakes = 0; this.startT = now(); this.needNew = hub.heldNotes().length > 0; this.reported = false;
    $('tContext').textContent = it.context || `Drill ${this.idx + 1} of ${this.items.length}`;
    $('tTarget').textContent = it.label;
    this.showSymbol(it);
    $('tTones').textContent = $('tHint').checked ? `Notes: ${it.toneNames.join(' – ')}` + (it.requireInversion ? ` · lowest note: ${ROOT_NAMES[it.bassPc]}` : '') : '';
    keyboard.set('hint', $('tHint').checked ? it.hint : []);
    keyboard.set('good', []);
    $('tFeedback').textContent = this.needNew ? 'Release the keys…' : 'Play it!'; $('tFeedback').className = 'feedback';
    $('tProgress').textContent = `${this.done} done · ${this.clean} clean · streak ${this.streak}` + (this.times.length ? ` · avg ${(this.times.reduce((a, b) => a + b, 0) / this.times.length).toFixed(1)}s` : '');
    clearTimeout(this.timer);
    if ($('tTimed').checked) this.timer = setTimeout(() => { if (this.running && this.items[this.idx] === it) { this.mistakes++; $('tFeedback').textContent = '⏱ time! It was: ' + it.toneNames.join(' '); keyboard.set('hint', it.hint); } }, 5000);
  },
  showSymbol(it) { $('tSymbol').innerHTML = chordHtml(it.requireInversion ? it.slash : it.symbol); },
  onNote() {
    if (!this.running || !$('tab-trainer').classList.contains('active')) return;
    const it = this.items[this.idx]; if (!it) return;
    const held = hub.heldNotes();
    if (this.needNew) { if (!held.length) { this.needNew = false; $('tFeedback').textContent = 'Play it!'; } return; }
    const r = checkChord(it, held);
    const fb = $('tFeedback');
    if (r.status === 'correct') {
      const sec = now() - this.startT;
      recordStat(tStats, it, sec, this.mistakes); localStorage.setItem('cfp-trainer-stats', JSON.stringify(tStats));
      this.done++; this.times.push(sec);
      if (!this.mistakes) { this.clean++; this.streak++; } else this.streak = 0;
      fb.textContent = `✔ ${fmtChord(detectChords(held)[0]?.symbol || it.symbol, { rootLabel: true }).text} — ${sec.toFixed(1)}s`; fb.className = 'feedback ok';
      keyboard.set('good', held); audio.success();
      this.running = false;
      this.timer = setTimeout(() => { this.running = true; this.idx++; if (this.idx >= this.items.length) { this.finish(); } else this.show(); }, 700);
      renderStats();
    } else if (r.status === 'wrong' && held.length >= 3) {
      if (!this.reported) { this.mistakes++; this.reported = true; }
      fb.textContent = `✖ not ${it.symbol}: remove ${r.extra.map((p) => ROOT_NAMES[p]).join(', ')}`; fb.className = 'feedback bad';
    } else if (r.status === 'wrong-inversion' && held.length >= it.pcs.length) {
      if (!this.reported) { this.mistakes++; this.reported = true; }
      fb.textContent = `Right notes, wrong inversion — lowest note should be ${ROOT_NAMES[it.bassPc]}`; fb.className = 'feedback warn';
    } else if (r.status === 'partial') {
      fb.textContent = `${held.length} note(s)…`; fb.className = 'feedback';
    } else if (!held.length) { this.reported = false; }
  },
  finish() {
    this.running = false;
    $('tTarget').textContent = `Done! ${this.clean}/${this.done} clean`;
    $('tSymbol').textContent = ''; $('tTones').textContent = ''; keyboard.set('hint', []);
    $('tFeedback').textContent = 'Press Start for another round (it reshuffles).';
  },
};
function renderStats() {
  const rows = Object.entries(tStats).filter(([k]) => k.startsWith('q:')).map(([k, s]) => {
    const [q, inv] = k.slice(2).split('|');
    return { name: `${q === 'maj' ? 'major' : QUALITY_BY_ID[q]?.name || q} · ${['root', '1st inv', '2nd inv', '3rd inv'][+inv]}`, ...s };
  }).sort((a, b) => b.totalSec / b.attempts - a.totalSec / a.attempts);
  const roots = ROOT_NAMES.map((n, i) => ({ n, s: tStats['r:' + i] })).filter((x) => x.s);
  $('tStats').innerHTML = rows.length ? `<table><tr><th>Chord</th><th>tries</th><th>clean</th><th>avg time</th></tr>${rows.map((r) => `<tr><td>${r.name}</td><td>${r.attempts}</td><td>${Math.round(100 * r.clean / r.attempts)}%</td><td>${(r.totalSec / r.attempts).toFixed(1)}s</td></tr>`).join('')}</table>`
    + `<p class="small">By root (avg s): ${roots.map((x) => `${x.n} ${(x.s.totalSec / x.s.attempts).toFixed(1)}`).join(' · ')}</p><p class="small">Slowest chord types are listed first — drill those.</p>` : '<p class="small">No data yet.</p>';
}
$('tStart').onclick = () => trainer.start();
$('tStop').onclick = () => trainer.stop();
$('tSkip').onclick = () => { if (!trainer.items.length) return; trainer.idx = (trainer.idx + 1) % trainer.items.length; trainer.running = true; trainer.show(); };
$('tResetStats').onclick = () => { if (confirm('Reset chord trainer stats?')) { for (const k in tStats) delete tStats[k]; localStorage.removeItem('cfp-trainer-stats'); renderStats(); } };
$('tHint').onchange = () => { if (trainer.running) trainer.show(); };

// ---------------- utils + boot ----------------
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'song'; }

(async function boot() {
  await store.init();
  await reloadSongs(currentSongId);
  editor.load(currentSong());
  renderStats();
  showTab(settings.tab || 'practice');
  updateLive();
  // expose for debugging / simulated MIDI from the console: cfp.sim([60,64,67])
  window.cfp = { hub, practice, trainer, lyrics: lyricsView, keyboard, store, audio, sim(notes, ms = 400) { notes.forEach((n) => hub.noteOn(n, 90)); setTimeout(() => notes.forEach((n) => hub.noteOff(n)), ms); } };
})();
