import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.cfp);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// live chord via simulated MIDI bytes
await page.evaluate(() => { const h = cfp.hub; [52, 55, 60].forEach((n) => h.handleBytes([0x90, n, 90])); });
await sleep(100);
console.log('live chord:', await page.$eval('#liveChord', (e) => e.textContent), await page.$eval('#liveInv', (e) => e.textContent));
await page.screenshot({ path: '/workspace/piano-app/tests/screens/practice.png' });
await page.evaluate(() => { [52, 55, 60].forEach((n) => cfp.hub.handleBytes([0x80, n, 0])); });

// Wait mode on Ode to Joy, right hand
await page.select('#pSong', 'seed-ode-to-joy');
await page.select('#pHands', 'right');
await page.select('#pMode', 'wait');
await page.click('#pStart');
const steps = await page.evaluate(() => cfp.practice.steps.map((s) => s.exact));
for (const st of steps) {
  await page.evaluate((ns) => { ns.forEach((n) => cfp.hub.handleBytes([0x90, n, 80])); ns.forEach((n) => cfp.hub.handleBytes([0x80, n, 0])); }, st);
}
await sleep(100);
console.log('wait result:', await page.$eval('#pStatus', (e) => e.textContent));

// Steady mode, melody+chords on Amazing Grace, fast tempo, simulated perfect player
await page.select('#pSong', 'seed-amazing-grace');
await page.select('#pHands', 'melody+chords');
await page.select('#pMode', 'steady');
await page.$eval('#pTempo', (e) => { e.value = 200; });
await page.select('#pCountIn', '0');
await page.$eval('#pTo', (e) => { e.value = 4; });
await page.click('#pStart');
await page.evaluate(() => {
  const P = cfp.practice; const eng = P.engine;
  for (const it of P.items) {
    const t = eng.startTime + it.beat * eng.spb;
    const ms = (t - performance.now() / 1000) * 1000;
    const notes = it.exact.length ? it.exact : it.pcs.map((pc) => 48 + pc);
    setTimeout(() => { notes.forEach((n) => cfp.hub.noteOn(n, 80, performance.now() / 1000)); setTimeout(() => notes.forEach((n) => cfp.hub.noteOff(n)), 100); }, ms);
  }
});
await sleep(5500);
console.log('steady result:', await page.$eval('#pStatus', (e) => e.textContent));
await page.screenshot({ path: '/workspace/piano-app/tests/screens/practice-steady.png' });

// generated ragtime arrangement both hands preview
await page.select('#pSong', 'seed-the-entertainer');
await page.select('#pHands', 'both');
await page.select('#pStyle', 'ragtime');
await sleep(200);
await page.screenshot({ path: '/workspace/piano-app/tests/screens/arrangement-ragtime.png' });

// trainer
await page.click('[data-tab=trainer]');
await page.click('#tStart');
for (let i = 0; i < 3; i++) {
  const hint = await page.evaluate(() => cfp.trainer.items[cfp.trainer.idx].hint);
  await page.evaluate((ns) => ns.forEach((n) => cfp.hub.noteOn(n, 80)), hint);
  await sleep(50);
  console.log('trainer:', await page.$eval('#tFeedback', (e) => e.textContent));
  await page.evaluate((ns) => ns.forEach((n) => cfp.hub.noteOff(n)), hint);
  await sleep(800);
}
await page.screenshot({ path: '/workspace/piano-app/tests/screens/trainer.png' });

// editor + step entry
await page.click('[data-tab=library]');
await page.click('#libNew');
await sleep(200);
await page.$eval('#eMelody', (e) => { e.value = ''; });
await page.$eval('#eChords', (e) => { e.value = ''; });
await page.click('#sOn');
for (const ch of [[60], [64], [67], [72]]) { await page.evaluate((ns) => { ns.forEach((n) => cfp.hub.noteOn(n)); ns.forEach((n) => cfp.hub.noteOff(n)); }, ch); }
await page.select('#sTarget', 'chords');
await page.click('#sDur button[data-d="4"]');
await page.evaluate(() => { [48, 52, 55].forEach((n) => cfp.hub.noteOn(n)); [48, 52, 55].forEach((n) => cfp.hub.noteOff(n)); });
console.log('step melody:', await page.$eval('#eMelody', (e) => e.value), '| chords:', await page.$eval('#eChords', (e) => e.value));
await sleep(500);
await page.click('[data-tab=library]');
await page.evaluate(() => { const s = document.querySelector('#libList li:nth-child(1)'); s.click(); });
await sleep(300);
await page.screenshot({ path: '/workspace/piano-app/tests/screens/editor.png', fullPage: true });
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await browser.close();
