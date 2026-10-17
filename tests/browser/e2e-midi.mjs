import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.evaluateOnNewDocument(() => {
  localStorage.clear();
  const mkPort = (id, name) => ({ id, name, manufacturer: 'Yamaha', onmidimessage: null, sent: [], send(d, ts) { this.sent.push([...d]); } });
  const ins = new Map([['in1', mkPort('in1', 'Digital Piano-1')], ['in2', mkPort('in2', 'Microsoft GS Wavetable')]]);
  const outs = new Map([['out1', mkPort('out1', 'Digital Piano-1')]]);
  window.__fakeMidi = { ins, outs };
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => ({ inputs: ins, outputs: outs, onstatechange: null }) });
  window.__send = (bytes) => ins.get('in1').onmidimessage && ins.get('in1').onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() });
});
await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.cfp);
await page.click('#midiConnect');
await new Promise((r) => setTimeout(r, 300));
console.log('status:', await page.$eval('#midiStatus', (e) => e.textContent), '| selected:', await page.$eval('#midiInput', (e) => e.options[e.selectedIndex].text));
await page.evaluate(() => { __send([0xfe]); __send([0x90, 43, 70]); __send([0x90, 59, 70]); __send([0x90, 62, 70]); __send([0x90, 65, 70]); });
await new Promise((r) => setTimeout(r, 100));
console.log('live chord from fake CVP:', await page.$eval('#liveChord', (e) => e.textContent), '/', await page.$eval('#liveNotes', (e) => e.textContent));
await page.evaluate(() => { [43, 59, 62, 65].forEach((n) => __send([0x90, n, 0])); });
// melody+chords wait mode on Amazing Grace via fake device
await page.select('#pSong', 'seed-amazing-grace');
await page.select('#pHands', 'melody+chords');
await page.select('#pMode', 'wait');
await page.click('#pStart');
await page.evaluate(() => { __send([0x90, 62, 80]); __send([0x80, 62, 0]); }); // pickup D4
await page.evaluate(() => { [43, 50, 59].forEach((n) => __send([0x90, n, 80])); __send([0x90, 67, 80]); }); // G chord + G4
await new Promise((r) => setTimeout(r, 100));
console.log('after 2 steps:', await page.$eval('#pStatus', (e) => e.textContent));
await page.screenshot({ path: '/workspace/piano-app/tests/screens/midi-melody-chords.png' });
// output routing
await page.select('#midiOutput', 'out1');
await page.click('#pListen');
await new Promise((r) => setTimeout(r, 800));
await page.click('#pStop');
console.log('notes sent to CVP output:', await page.evaluate(() => __fakeMidi.outs.get('out1').sent.length));
console.log('ERRORS:', errs.join('\n') || 'none');
await browser.close();
