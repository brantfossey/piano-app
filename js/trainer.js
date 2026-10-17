// Chord & inversion drill logic (pure).
import { QUALITY_BY_ID, mod12, inversionCount, voiceChord, chordSymbol, namesForKey, ROOT_NAMES, FLAT_NAMES, INVERSION_NAMES } from './theory.js';

export const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
export const DRILL_QUALITIES = ['maj', 'min', 'dim', 'aug', 'sus4', '7', 'maj7', 'm7', 'm7b5', 'dim7', '6'];
const MAJOR_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export const PROGRESSIONS = {
  'I-IV-V-I': { name: 'I – IV – V – I (voice-led inversions)', steps: [[0, 'maj', 0], [5, 'maj', 2], [7, 'maj', 1], [0, 'maj', 0]], inv: true },
  'I-vi-IV-V': { name: 'I – vi – IV – V (pop)', steps: [[0, 'maj', null], [9, 'min', null], [5, 'maj', null], [7, 'maj', null]] },
  'ii-V-I': { name: 'ii7 – V7 – Imaj7 (jazz/gospel)', steps: [[2, 'm7', null], [7, '7', null], [0, 'maj7', null]] },
  'I-I7-IV-iv': { name: 'I – I7 – IV – iv (gospel/hymn)', steps: [[0, 'maj', null], [0, '7', null], [5, 'maj', null], [5, 'min', null]] },
  'I-V7-I': { name: 'I – V7 – I (hymn / country)', steps: [[0, 'maj', 0], [7, '7', 1], [0, 'maj', 0]], inv: true },
};

function shuffle(a, rnd = Math.random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/**
 * Build a drill list.
 * opts: {drill:'chords'|'progression', roots:[pc], qualities:[id], inversions:[0..3], order:'random'|'circle'|'chromatic',
 *        progression:'I-IV-V-I', requireInversion:true, rnd}
 */
export function buildDrill(opts = {}) {
  const roots = opts.roots?.length ? opts.roots : [...Array(12).keys()];
  const order = opts.order || 'random';
  const orderedRoots = order === 'circle' ? CIRCLE_OF_FIFTHS.filter((r) => roots.includes(r)) : [...roots].sort((a, b) => a - b);
  const items = [];
  if (opts.drill === 'progression') {
    const prog = PROGRESSIONS[opts.progression] || PROGRESSIONS['I-IV-V-I'];
    const keys = order === 'random' ? shuffle([...orderedRoots], opts.rnd) : orderedRoots;
    for (const k of keys) {
      const keyName = MAJOR_KEY_NAMES[k];
      const names = namesForKey(keyName);
      prog.steps.forEach(([deg, q, inv], i) => {
        const root = mod12(k + deg);
        items.push(makeItem(root, q, inv ?? 0, { names, requireInversion: inv != null && opts.requireInversion !== false, context: `Key of ${keyName}: ${prog.name} (${i + 1}/${prog.steps.length})` }));
      });
    }
    return items;
  }
  const qualities = opts.qualities?.length ? opts.qualities : ['maj', 'min'];
  const invs = opts.inversions?.length ? opts.inversions : [0, 1, 2];
  for (const r of orderedRoots) for (const q of qualities) for (const inv of invs) {
    if (inv >= inversionCount(q)) continue;
    items.push(makeItem(r, q, inv, { names: r === 6 ? FLAT_NAMES.map((n, i) => (i === 6 ? 'F#' : n)) : ROOT_NAMES, requireInversion: opts.requireInversion !== false }));
  }
  return order === 'random' ? shuffle(items, opts.rnd) : items;
}

export function makeItem(rootPc, qid, inversion = 0, { names = ROOT_NAMES, requireInversion = true, context = '' } = {}) {
  const q = QUALITY_BY_ID[qid];
  const tones = [...new Set(q.iv.map((i) => mod12(rootPc + i)))];
  const ordered = [...new Set(q.iv.map(mod12))].sort((a, b) => a - b).map((i) => mod12(rootPc + i));
  const bassPc = ordered[inversion % ordered.length];
  return {
    rootPc, quality: qid, inversion, requireInversion, context,
    pcs: tones, bassPc,
    symbol: chordSymbol(rootPc, qid, null, names),
    slash: inversion ? chordSymbol(rootPc, qid, bassPc, names) : chordSymbol(rootPc, qid, null, names),
    label: `${names[rootPc]} ${q.name}` + (requireInversion ? ` — ${INVERSION_NAMES[inversion] || 'inversion ' + inversion}` : ''),
    hint: voiceChord(rootPc, qid, inversion, 55),
    toneNames: ordered.map((pc) => names[pc]),
  };
}

/** Evaluate currently held notes against a drill item. */
export function checkChord(item, notes) {
  if (!notes.length) return { status: 'idle', missing: item.pcs, extra: [], bassOk: false };
  const sorted = [...notes].sort((a, b) => a - b);
  const have = new Set(sorted.map(mod12));
  const missing = item.pcs.filter((p) => !have.has(p));
  const extra = [...have].filter((p) => !item.pcs.includes(p));
  const bassOk = mod12(sorted[0]) === item.bassPc;
  let status;
  if (extra.length) status = 'wrong';
  else if (missing.length) status = 'partial';
  else if (item.requireInversion && !bassOk) status = 'wrong-inversion';
  else status = 'correct';
  return { status, missing, extra, bassOk };
}

/** Accumulate stats {key: {attempts, clean, totalSec}} keyed by quality|inversion and by root. */
export function recordStat(stats, item, sec, mistakes) {
  const keys = [`q:${item.quality}|${item.inversion}`, `r:${item.rootPc}`];
  for (const k of keys) {
    const s = (stats[k] ||= { attempts: 0, clean: 0, totalSec: 0 });
    s.attempts++; if (!mistakes) s.clean++; s.totalSec += sec;
  }
  return stats;
}
