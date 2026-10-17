// Headless Chrome check of the Lyrics & Chords view, follow-along, inversion display setting,
// key/staff highlights and the responsive footer layout. Run with a static server on :8080.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const APP = process.env.APP_URL || 'http://localhost:8080/index.html';
const shots = new URL('../screens/', import.meta.url).pathname; mkdirSync(shots, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

async function open(viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(APP, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.cfp && document.querySelector('#lSong option'));
  return page;
}
const play = (page, notes) => page.evaluate((ns) => ns.forEach((n) => cfp.hub.handleBytes([0x90, n, 80])), notes);
const release = (page, notes) => page.evaluate((ns) => ns.forEach((n) => cfp.hub.handleBytes([0x80, n, 0])), notes);
const state = (page) => page.evaluate(() => ({
  idx: cfp.lyrics.engine.index,
  current: document.querySelector('.lc.current')?.textContent || null,
  symbol: document.querySelector('#lSymbol').textContent,
  keyTargets: [...document.querySelectorAll('#keyboard .key.target')].map((k) => +k.dataset.note).sort((a, b) => a - b),
  keyPlayed: [...document.querySelectorAll('#keyboard .key.played')].map((k) => +k.dataset.note).sort((a, b) => a - b),
  headTargets: [...document.querySelectorAll('#liveStaff .head.target')].map((h) => +h.dataset.midi).sort((a, b) => a - b),
  headPlayed: [...document.querySelectorAll('#liveStaff .head.played')].map((h) => +h.dataset.midi).sort((a, b) => a - b),
}));

// ---------- desktop (Windows-like 1366x768) ----------
{
  const page = await open({ width: 1366, height: 768 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.cfp && document.querySelector('#lSong option'));
  await page.click('[data-tab=lyrics]');
  await page.select('#lSong', 'seed-amazing-grace');
  await sleep(100);
  check(await page.$$eval('.lline', (l) => l.length) >= 8, 'chord sheet renders lyric lines');
  check(await page.$eval('.lsection', (e) => e.textContent) === 'Verse 1', 'section headers shown');
  // chord sits above its word
  const pos = await page.evaluate(() => { const c = document.querySelector('.lc.target'); const t = c.nextElementSibling; return { c: c.getBoundingClientRect().toJSON(), t: t.getBoundingClientRect().toJSON(), word: t.textContent }; });
  check(pos.c.bottom <= pos.t.top + 1 && Math.abs(pos.c.left - pos.t.left) < 2 && pos.word.startsWith('mazing'), 'chord G is drawn directly above "mazing" ' + JSON.stringify(pos));
  await page.click('#lStart');
  await sleep(50);
  let s = await state(page);
  check(s.idx === 0 && s.current === 'G', 'follow-along: first chord highlighted');
  check(JSON.stringify(s.keyTargets) === JSON.stringify([55, 67, 71, 74]) || s.keyTargets.length === 4, `target notes on keys ${s.keyTargets}`);
  check(JSON.stringify(s.headTargets) === JSON.stringify(s.keyTargets), `same target notes on the staff ${s.headTargets}`);
  // play G in 1st inversion with an extra note, low register
  await play(page, [47, 50, 55, 57]); await sleep(60);
  s = await state(page);
  check(s.idx === 1 && s.current === 'G7', 'G (1st inversion + extra A) advances to G7');
  check(s.headPlayed.join() === '47,50,55,57' && s.keyPlayed.join() === '47,50,55,57', 'pressed notes highlighted on keys and staff alike');
  await page.screenshot({ path: shots + 'lyrics-desktop.png' });
  await release(page, [47, 50, 55, 57]);
  await play(page, [43, 53, 59]); await release(page, [43, 53, 59]); await sleep(40); // G7 without 5th
  s = await state(page); check(s.current === 'C', 'G7 rootless-5th voicing accepted → C');
  await play(page, [60, 64]); await sleep(40);
  s = await state(page); check(s.current === 'C' && /missing/.test(await page.$eval('#lFeedback', (e) => e.textContent)) === false, 'two notes are not enough, no advance');
  await play(page, [67]); await release(page, [60, 64, 67]); await sleep(40);
  s = await state(page); check(s.idx === 3, 'C completed → next chord');
  await page.click('#lNext'); await page.click('#lNext'); s = await state(page); check(s.idx === 5, 'Next button skips ahead');
  await page.click('#lBack'); s = await state(page); check(s.idx === 4, 'Back button');
  await page.keyboard.press('ArrowRight'); s = await state(page); check(s.idx === 5, '→ key steps forward');
  await page.click('#lRestart'); s = await state(page); check(s.idx === 0 && s.current === 'G', 'Restart');
  await page.evaluate(() => document.querySelectorAll('.lc.target')[6].click()); s = await state(page); check(s.idx === 6, 'click a chord to jump');

  // inversion display setting, persisted
  await page.select('#lSong', 'seed-saints'); await sleep(50);
  await page.evaluate(() => [64, 67, 72].forEach((n) => cfp.hub.noteOn(n))); await sleep(40);
  await page.select('#invDisplay', 'slash'); await sleep(40);
  check(await page.$eval('#liveChord', (e) => e.textContent) === 'C/E', 'slash mode: C/E');
  await page.select('#invDisplay', 'label'); await sleep(40);
  check(await page.$eval('#liveChord', (e) => e.textContent) === 'C' && await page.$eval('#liveInv', (e) => e.textContent) === '1st inversion', 'label mode: C + "1st inversion"');
  await page.select('#invDisplay', 'base'); await sleep(40);
  check(await page.$eval('#liveChord', (e) => e.textContent) === 'C' && await page.$eval('#liveInv', (e) => e.textContent) === '', 'base mode: C only');
  await page.evaluate(() => [64, 67, 72].forEach((n) => cfp.hub.noteOff(n)));
  // song with a slash chord in sheet + score
  await page.click('[data-tab=library]');
  await page.click('#libPaste');
  await page.$eval('#pasteText', (e) => { e.value = JSON.stringify({ title: 'Slash test', key: 'D', timeSignature: '4/4', melodyText: '| F#4:4 | E4:4 |', chordsText: '| D/F# | A |', lyricsText: '[D/F#]Hello [A/C#]world' }); });
  await page.click('#pasteDlg button[value=ok]'); await sleep(300);
  await page.click('[data-tab=lyrics]'); await sleep(50);
  await page.select('#invDisplay', 'label'); await sleep(40);
  check(await page.$eval('.lc.target', (e) => e.textContent) === 'D1st inversion', 'sheet chord in label mode: D + small "1st inversion"');
  await page.select('#invDisplay', 'base'); await sleep(40);
  check(await page.$eval('.lc.target', (e) => e.textContent) === 'D', 'sheet chord in base mode: D');
  await page.click('[data-tab=practice]'); await sleep(100);
  check(await page.$eval('#pScore .chordsym', (e) => e.textContent) === 'D', 'score chord symbols follow the setting');
  await page.select('#invDisplay', 'slash'); await sleep(60);
  check(await page.$eval('#pScore .chordsym', (e) => e.textContent) === 'D/F#', 'score: slash mode');
  await page.select('#invDisplay', 'label');
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.cfp);
  check(await page.$eval('#invDisplay', (e) => e.value) === 'label', 'inversion display setting persisted');

  // layout: staff at far left, keyboard right of it to the right edge, controls just above the staff, all at the bottom
  const L = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect().toJSON();
    return { staff: r('#liveStaff'), kb: r('#keyboard'), ctrl: r('.kbctrl'), foot: r('footer.live'), vw: innerWidth, vh: innerHeight, keys: document.querySelectorAll('#keyboard .key').length };
  });
  check(L.staff.left < 12 && L.kb.left >= L.staff.right && L.kb.left - L.staff.right < 16 && L.vw - L.kb.right < 12, `desktop: staff left (${L.staff.left}-${L.staff.right}), keys ${L.kb.left}-${L.kb.right} of ${L.vw}`);
  check(L.ctrl.bottom <= L.staff.top + 1 && L.staff.top - L.ctrl.bottom < 8, 'hide-keys/key-count controls just above the staff');
  check(Math.abs(L.foot.bottom - L.vh) < 1 && L.foot.height < 195, `footer at the bottom, compact (${Math.round(L.foot.height)}px)`);
  check(L.keys === 88, '88 keys by default on desktop');
  // editor shows the lyrics field of the selected song
  await page.click('[data-tab=library]');
  await page.evaluate(() => [...document.querySelectorAll('#libList li')].find((li) => li.textContent.includes('Amazing')).click()); await sleep(100);
  check((await page.$eval('#eLyrics', (e) => e.value)).startsWith('[Verse 1]\nA[G]mazing'), 'editor shows lyricsText');
  await page.click('[data-tab=lyrics]');
  await page.screenshot({ path: shots + 'lyrics-desktop-label.png' });
  await page.click('#kbToggle'); await sleep(80);
  check(await page.$eval('#keyboard', (e) => getComputedStyle(e).display) === 'none', 'hide keys works');
  await page.click('#kbToggle');
  await page.close();
}

// ---------- Android Chrome widths ----------
for (const vp of [{ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { width: 915, height: 412, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { width: 360, height: 740, isMobile: true, hasTouch: true }]) {
  const page = await open(vp);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.cfp && document.querySelector('#lSong option'));
  await page.click('[data-tab=lyrics]');
  await page.select('#lSong', 'seed-amazing-grace');
  await page.$eval('#lStart', (b) => b.click()); await sleep(60);
  const L = await page.evaluate(() => {
    const r = (sel) => document.querySelector(sel).getBoundingClientRect().toJSON();
    return { staff: r('#liveStaff'), kb: r('#keyboard'), ctrl: r('.kbctrl'), foot: r('footer.live'), vw: innerWidth, vh: innerHeight, docW: document.documentElement.scrollWidth,
      pad: parseFloat(document.body.style.paddingBottom), lineOverflow: [...document.querySelectorAll('.lline')].some((l) => l.scrollWidth > l.clientWidth + 1) };
  });
  const tag = `${vp.width}x${vp.height}`;
  check(L.docW <= L.vw + 1, `${tag}: no horizontal page overflow (${L.docW})`);
  check(L.staff.left < 12 && L.kb.left >= L.staff.right && L.vw - L.kb.right < 12 && L.kb.width > L.vw * 0.5, `${tag}: staff left, keyboard fills the rest (${Math.round(L.kb.width)}px)`);
  check(L.ctrl.bottom <= L.staff.top + 1, `${tag}: controls above the staff`);
  check(L.pad >= L.foot.height, `${tag}: content padded above the footer`);
  check(!L.lineOverflow, `${tag}: lyric lines wrap`);
  // touch the on-screen keys: G B D advances
  await page.evaluate(() => [55, 59, 62].forEach((n) => cfp.hub.noteOn(n, 80, performance.now() / 1000, 'screen'))); await sleep(50);
  check(await page.evaluate(() => cfp.lyrics.engine.index) === 1, `${tag}: follow-along advances`);
  await page.screenshot({ path: shots + `lyrics-android-${tag}.png` });
  await page.close();
}
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
console.log(fails ? `${fails} check(s) FAILED` : 'all browser checks passed');
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
