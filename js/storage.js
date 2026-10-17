// Song library persistence: IndexedDB (primary) with localStorage fallback.
import { normalizeSong, songToJson } from './songformat.js';
import { SEED_SONGS } from './seeds.js';

const DB = 'chord-fluency-piano', STORE = 'songs', LS_KEY = 'cfp-songs-v1';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SongStore {
  constructor() { this.db = null; this.mem = new Map(); this.mode = 'memory'; }
  async init() {
    try { this.db = await openDb(); this.mode = 'indexedDB'; }
    catch { this.mode = typeof localStorage !== 'undefined' ? 'localStorage' : 'memory'; }
    const all = await this.all();
    if (!all.length && !this.flag('seeded')) {
      for (const s of SEED_SONGS) await this.put(normalizeSong(s).song);
      this.flag('seeded', true);
    } else if (!this.flag('seed-lyrics-v1')) {
      // libraries created before the Lyrics & Chords view: add the example lyrics to untouched-lyrics seed songs
      for (const seed of SEED_SONGS) {
        const have = all.find((s) => s.id === seed.id);
        if (have && !have.lyrics && seed.lyricsText) { have.lyrics = normalizeSong(seed).song.lyrics; await this.put(have); }
      }
    }
    this.flag('seed-lyrics-v1', true);
  }
  flag(k, v) {
    if (typeof localStorage === 'undefined') return v;
    if (v === undefined) return localStorage.getItem('cfp-flag-' + k) === '1';
    localStorage.setItem('cfp-flag-' + k, v ? '1' : '0');
  }
  async all() {
    let raw;
    if (this.mode === 'indexedDB') {
      raw = await new Promise((res, rej) => { const r = this.db.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    } else if (this.mode === 'localStorage') raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    else raw = [...this.mem.values()];
    return raw.map((j) => normalizeSong(j).song).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
  }
  async put(song) {
    const j = songToJson(song);
    if (this.mode === 'indexedDB') {
      await new Promise((res, rej) => { const tx = this.db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(j); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } else if (this.mode === 'localStorage') {
      const list = JSON.parse(localStorage.getItem(LS_KEY) || '[]').filter((x) => x.id !== j.id);
      list.push(j); localStorage.setItem(LS_KEY, JSON.stringify(list));
    } else this.mem.set(j.id, j);
  }
  async remove(id) {
    if (this.mode === 'indexedDB') {
      await new Promise((res, rej) => { const tx = this.db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } else if (this.mode === 'localStorage') {
      localStorage.setItem(LS_KEY, JSON.stringify(JSON.parse(localStorage.getItem(LS_KEY) || '[]').filter((x) => x.id !== id)));
    } else this.mem.delete(id);
  }
  async restoreSeeds() { for (const s of SEED_SONGS) await this.put(normalizeSong(s).song); }
}
