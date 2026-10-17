// MIDI input/output handling. Works with real Web MIDI and with simulated input
// (on-screen keyboard, computer keyboard, tests).

/** Parse raw MIDI bytes. Returns {type, channel, note, velocity, controller, value} or null. */
export function parseMidiMessage(data) {
  if (!data || data.length < 1) return null;
  const status = data[0];
  if (status >= 0xf0) return null; // clock, active sensing, sysex: ignore
  const type = status & 0xf0, channel = (status & 0x0f) + 1;
  if (type === 0x90 && data.length >= 3) {
    return data[2] > 0 ? { type: 'noteon', channel, note: data[1], velocity: data[2] } : { type: 'noteoff', channel, note: data[1], velocity: 0 };
  }
  if (type === 0x80 && data.length >= 3) return { type: 'noteoff', channel, note: data[1], velocity: data[2] };
  if (type === 0xb0 && data.length >= 3) return { type: 'cc', channel, controller: data[1], value: data[2] };
  return null;
}

/**
 * Tracks held keys and sustain pedal, emits events to listeners.
 * held   = keys physically down (used for chord checking)
 * sounding = held + sustained by pedal (used for display)
 */
export class MidiHub {
  constructor() {
    this.listeners = new Set();
    this.held = new Map(); // note -> {velocity, time}
    this.sustained = new Set();
    this.pedal = false;
    this.channelFilter = 0; // 0 = all channels
    this.access = null;
    this.input = null;
    this.output = null;
    this.thru = false;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn(ev, this); } catch (e) { console.error(e); } } }
  heldNotes() { return [...this.held.keys()].sort((a, b) => a - b); }
  soundingNotes() { return [...new Set([...this.held.keys(), ...this.sustained])].sort((a, b) => a - b); }

  /** Feed raw MIDI bytes (from a real device or simulation). */
  handleBytes(data, time = now()) {
    const m = parseMidiMessage(data);
    if (!m) return;
    if (this.channelFilter && m.channel !== this.channelFilter) return;
    if (m.type === 'noteon') this.noteOn(m.note, m.velocity, time, 'midi');
    else if (m.type === 'noteoff') this.noteOff(m.note, time, 'midi');
    else if (m.type === 'cc' && m.controller === 64) this.setPedal(m.value >= 64, time);
  }
  noteOn(note, velocity = 90, time = now(), source = 'sim') {
    this.held.set(note, { velocity, time });
    this.sustained.delete(note);
    this.emit({ type: 'noteon', note, velocity, time, source });
  }
  noteOff(note, time = now(), source = 'sim') {
    if (!this.held.has(note)) return;
    this.held.delete(note);
    if (this.pedal) this.sustained.add(note);
    this.emit({ type: 'noteoff', note, time, source });
  }
  setPedal(down, time = now()) {
    this.pedal = down;
    if (!down) this.sustained.clear();
    this.emit({ type: 'pedal', down, time });
  }
  allOff() {
    for (const n of [...this.held.keys()]) this.noteOff(n);
    this.setPedal(false);
  }

  // ----- Web MIDI -----
  static supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }
  async requestAccess() {
    if (!MidiHub.supported()) throw new Error('Web MIDI is not available in this browser. Use Chrome or Edge (Windows/Android/macOS) over https:// or http://localhost.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = (e) => this.emit({ type: 'devices', port: e.port });
    return this.access;
  }
  inputs() { return this.access ? [...this.access.inputs.values()] : []; }
  outputs() { return this.access ? [...this.access.outputs.values()] : []; }
  selectInput(id) {
    if (this.input) this.input.onmidimessage = null;
    this.input = this.inputs().find((i) => i.id === id) || null;
    if (this.input) {
      this.input.onmidimessage = (e) => {
        // e.timeStamp is on the performance.now() clock (ms)
        this.handleBytes(e.data, (e.timeStamp || performance.now()) / 1000);
        if (this.thru && this.output) this.output.send(e.data);
      };
    }
    this.allOff();
    return this.input;
  }
  selectOutput(id) {
    this.output = this.outputs().find((o) => o.id === id) || null;
    return this.output;
  }
}

/** Seconds on the performance clock. */
export function now() {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
}

/** Computer-keyboard to MIDI mapping for testing without a piano (two rows, like a DAW). */
export const COMPUTER_KEYS = {
  // lower row: C3..E4  (z s x d c v g b h n j m , l . ; /)
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12, l: 13, '.': 14, ';': 15, '/': 16,
  // upper row: C4..F5 (q 2 w 3 e r 5 t 6 y 7 u i 9 o 0 p [ = ])
  q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28, '[': 29, '=': 30, ']': 31,
};
