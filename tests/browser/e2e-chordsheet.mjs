// Headless Chrome check of "Paste chord sheet" (Library & Editor → lyrics). Made-up sample text, not real lyrics.
// Run with a static server on :8080.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const APP = process.env.APP_URL || 'http://localhost:8080/index.html';
const shots = new URL('../screens/', import.meta.url).pathname; mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = []; let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const SAMPLE = '[Intro]\nC    G/B   Am7(#5)   F\n\n[Verse 1]\nC              G\nPaper boats go sailing\n    Am7          Bb7sus2\ndown the little river';
const ID = 'nothings-gonna-change-my-love-for-you';

const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('dialog', (d) => d.accept());
await page.goto(APP, { waitUntil: 'networkidle0' });
await page.evaluate(async () => { localStorage.clear(); await new Promise((r) => { const q = indexedDB.deleteDatabase('chord-fluency-piano'); q.onsuccess = q.onerror = q.onblocked = r; }); });
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.cfp && document.querySelector('#lSong option'));
// lyrics view of the chords-only song says it is a placeholder
await page.click('[data-tab=lyrics]'); await page.select('#lSong', ID); await sleep(100);
check(/chords only/.test(await page.$eval('#lSource', (e) => e.textContent)), 'chords-only song flagged as placeholder in the lyrics view');
// editor: paste & convert
await page.click('[data-tab=library]'); await sleep(100);
await page.evaluate((id) => [...document.querySelectorAll('#libList li')].find((li) => li.textContent.includes('Nothing')).click(), ID); await sleep(100);
await page.evaluate(() => { document.querySelector('#eLyrDetails').open = true; });
check(await page.$eval('#eSimplify', (e) => e.checked), '"simplify unsupported chords" is on by default');
await page.$eval('#ePasteSheet', (e, v) => { e.value = v; }, SAMPLE);
await page.$eval('#eConvertSheet', (b) => { b.scrollIntoView({ block: 'center' }); b.click(); }); await sleep(400);
const lyr = await page.$eval('#eLyrics', (e) => e.value);
check(lyr === '[Intro]\n[C] [G/B] [Am7] [F]\n\n[Verse 1]\n[C]Paper boats go [G]sailing\ndown [Am7]the little r[Bb7sus4]iver', 'converted lyricsText in the editor: ' + JSON.stringify(lyr));
const msg = await page.$eval('#eConvertMsg', (e) => e.textContent);
check(/saved in this browser/.test(msg) && /Am7\(#5\) → Am7/.test(msg) && /Bb7sus2 → Bb7sus4/.test(msg), 'status: ' + msg);
await page.screenshot({ path: shots + 'chordsheet-editor.png', fullPage: false });
// persisted in IndexedDB: survives reload, shown in the lyrics view
await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.cfp && document.querySelector('#lSong option'));
await page.click('[data-tab=lyrics]'); await page.select('#lSong', ID); await sleep(150);
const words = await page.$$eval('.lline', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ')));
check(words.some((w) => w.includes('Paper boats')) && !/chords only/.test(await page.$eval('#lSource', (e) => e.textContent)), 'lyrics view shows the pasted words after reload (IndexedDB)');
check(await page.$$eval('.lc.target', (c) => c.map((x) => x.textContent).join(' ')) === 'C G/B Am7 F C G Am7 Bb7sus4', 'follow-along chords');
const stored = await page.evaluate((id) => new Promise((res) => { const o = indexedDB.open('chord-fluency-piano'); o.onsuccess = () => { const r = o.result.transaction('songs').objectStore('songs').get(id); r.onsuccess = () => res(r.result?.lyricsText || ''); }; }), ID);
check(stored.includes('Paper boats'), 'stored on the song in IndexedDB');
await page.screenshot({ path: shots + 'chordsheet-lyrics.png' });
// Restore examples keeps the pasted words of the chords-only song
await page.click('[data-tab=library]'); await page.$eval('#libSeeds', (b) => b.click()); await sleep(400);
await page.click('[data-tab=lyrics]'); await page.select('#lSong', ID); await sleep(150);
check((await page.$$eval('.lline', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ')))).some((w) => w.includes('Paper boats')), '"Restore examples" keeps the pasted lyrics');
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
console.log(fails ? `${fails} check(s) FAILED` : 'all chord-sheet browser checks passed');
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
