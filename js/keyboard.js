// On-screen piano keyboard (SVG). Shows played / target / wrong / hint notes; clickable & multi-touch.
const SVGNS = 'http://www.w3.org/2000/svg';
const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);

export class PianoKeyboard {
  constructor(container, { low = 21, high = 108, onNoteOn = () => {}, onNoteOff = () => {}, onChange = () => {} } = {}) {
    this.container = container; this.onNoteOn = onNoteOn; this.onNoteOff = onNoteOff; this.onChange = onChange;
    this.pointers = new Map();
    this.state = { played: new Set(), target: new Set(), wrong: new Set(), hint: new Set(), good: new Set() };
    this.setRange(low, high);
  }
  setRange(low, high) {
    if (isBlack(low)) low--; if (isBlack(high)) high++;
    this.low = low; this.high = high; this.render();
  }
  render() {
    const whites = [];
    for (let n = this.low; n <= this.high; n++) if (!isBlack(n)) whites.push(n);
    const W = 24, H = 120, BW = 14, BH = 76;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${whites.length * W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('piano');
    this.keys = new Map();
    const pos = new Map();
    whites.forEach((n, i) => pos.set(n, i * W));
    const mk = (n, x, w, h, cls) => {
      const r = document.createElementNS(SVGNS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', 0); r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('rx', 2); r.classList.add('key', cls); r.dataset.note = n;
      svg.appendChild(r); this.keys.set(n, r);
    };
    whites.forEach((n) => mk(n, pos.get(n), W, H, 'white'));
    whites.forEach((n) => {
      if (n % 12 === 0) {
        const t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('x', pos.get(n) + W / 2); t.setAttribute('y', H - 6);
        t.setAttribute('text-anchor', 'middle'); t.classList.add('keylabel');
        t.textContent = 'C' + (Math.floor(n / 12) - 1);
        svg.appendChild(t);
      }
    });
    for (let n = this.low; n <= this.high; n++) if (isBlack(n)) mk(n, pos.get(n - 1) + W - BW / 2, BW, BH, 'black');
    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => { if (this.pointers.has(e.pointerId) && e.buttons) this.move(e); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => svg.addEventListener(t, (e) => this.up(e)));
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this.svg = svg;
    this.apply();
  }
  noteFromEvent(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && el.dataset && el.dataset.note ? +el.dataset.note : null;
  }
  down(e) {
    e.preventDefault();
    const n = this.noteFromEvent(e); if (n == null) return;
    try { this.svg.setPointerCapture(e.pointerId); } catch {}
    this.pointers.set(e.pointerId, n); this.onNoteOn(n, 90);
  }
  move(e) {
    const n = this.noteFromEvent(e); const prev = this.pointers.get(e.pointerId);
    if (n != null && n !== prev) { if (prev != null) this.onNoteOff(prev); this.pointers.set(e.pointerId, n); this.onNoteOn(n, 90); }
  }
  up(e) {
    const prev = this.pointers.get(e.pointerId);
    if (prev != null) this.onNoteOff(prev);
    this.pointers.delete(e.pointerId);
  }
  /** Set the notes of one highlight state. No-op if unchanged; onChange(kind) fires otherwise. */
  set(kind, notes) {
    const next = new Set(notes || []);
    const prev = this.state[kind];
    if (prev && prev.size === next.size && [...next].every((n) => prev.has(n))) return false;
    this.state[kind] = next; this.apply(); this.onChange(kind);
    return true;
  }
  /** Space-separated state classes of a note ('played target' …), shared with the staff renderer. */
  classesOf(n) { return Object.keys(this.state).filter((k) => this.state[k].has(n)).join(' '); }
  /** All notes that currently carry any highlight. */
  highlighted() { return [...new Set(Object.values(this.state).flatMap((s) => [...s]))].sort((a, b) => a - b); }
  apply() {
    if (!this.keys) return;
    for (const [n, el] of this.keys) {
      const s = this.state;
      el.classList.toggle('played', s.played.has(n));
      el.classList.toggle('target', s.target.has(n));
      el.classList.toggle('wrong', s.wrong.has(n));
      el.classList.toggle('hint', s.hint.has(n));
      el.classList.toggle('good', s.good.has(n));
    }
  }
}
