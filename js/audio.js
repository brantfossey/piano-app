// Simple WebAudio piano-ish synth + metronome, with optional routing to a MIDI output (e.g. the CVP itself).
import { now } from './midi.js';

export class AudioEngine {
  constructor() { this.ctx = null; this.master = null; this.midiOut = null; this.useMidiOut = false; this.volume = 0.6; this.outChannel = 0; }
  ensure() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  toCtx(t) { return this.ctx.currentTime + Math.max(0, t - now()); }

  /** Play a note. when = seconds on performance clock (default now). */
  note(midi, dur = 0.5, vel = 0.7, when = now()) {
    if (this.useMidiOut && this.midiOut) {
      const ms = when * 1000;
      const v = Math.max(1, Math.min(127, Math.round(vel * 127)));
      this.midiOut.send([0x90 | this.outChannel, midi, v], ms);
      this.midiOut.send([0x80 | this.outChannel, midi, 0], ms + dur * 1000);
      return;
    }
    const ctx = this.ensure(); if (!ctx) return;
    const t0 = this.toCtx(when);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = Math.min(9000, f * 6 + 600);
    const o1 = ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(filt); filt.connect(this.master);
    const peak = 0.28 * vel * (midi < 48 ? 1.2 : 1);
    const decay = Math.min(2.5, Math.max(0.4, 3.2 - (midi - 40) / 25));
    const end = t0 + Math.min(dur + 0.25, decay + 0.3);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + Math.min(decay * 0.4, dur));
    g.gain.setValueAtTime(peak * 0.35, Math.max(t0 + 0.01, t0 + dur - 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o1.start(t0); o2.start(t0); o1.stop(end + 0.05); o2.stop(end + 0.05);
  }
  chord(pitches, dur, vel, when) { pitches.forEach((p) => this.note(p, dur, vel, when)); }

  click(accent = false, when = now()) {
    const ctx = this.ensure(); if (!ctx) return;
    const t0 = this.toCtx(when);
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(accent ? 0.25 : 0.14, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.06);
  }
  success() { const t = now(); this.note(84, 0.12, 0.35, t); this.note(91, 0.2, 0.35, t + 0.08); }
}
