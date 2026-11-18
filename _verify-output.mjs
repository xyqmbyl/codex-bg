// Live output-panel regression. --exercise checks 50%/100%, saving and reset, then restores saved values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
const target = targets.find(t => t.url === 'app://-/index.html');
assert(target, 'Codex main window must be open');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0; const pending = new Map();
ws.onmessage = event => { const r = JSON.parse(event.data); pending.get(r.id)?.(r); };
async function evaluate(expression) {
  const n = ++id; let timer;
  try {
    const r = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP timeout')), 10000); pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    assert(!r.error && !r.result.exceptionDetails, JSON.stringify(r.error || r.result.exceptionDetails));
    return r.result.result.value;
  } finally { clearTimeout(timer); pending.delete(n); }
}
const sample = `(() => {
  const root = document.querySelector('[data-summary-panel-variant="summary"][data-summary-panel-density]');
  const ui = window.__zcodeBgUi;
  const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')].find(e => e.textContent.includes('输出内容浮窗不透明度'));
  const r = row?.querySelector('input[type="range"]');
  const alpha = (e, pseudo) => { const c = document.createElement('canvas'); c.width = c.height = 1;
    const x = c.getContext('2d'); x.fillStyle = getComputedStyle(e, pseudo).backgroundColor; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data[3] / 255; };
  return { value: ui.state.outputAlpha, slider: r ? Number(r.value) : null, label: r?.getAttribute('aria-label'),
    reset: !!row && [...row.querySelectorAll('button')].some(e => e.textContent === '与聊天区一致'),
    alpha: root ? alpha(root) : null, opacity: root && getComputedStyle(root).opacity,
    headers: root ? [...root.querySelectorAll('header')].map(e => [alpha(e), alpha(e, '::before')]) : [],
    buttons: root?.querySelectorAll('button').length,
    independent: [ui.state.panelAlpha, ui.state.sidebarAlpha, ui.state.composerAlpha, ui.state.menuAlpha] };
})()`;
function verify(s, value) {
  assert.notEqual(s.slider, null, 'Output panel opacity slider must exist');
  assert.equal(s.label, '输出内容浮窗不透明度'); assert(s.reset, 'Output panel reset button must exist');
  assert.equal(s.value, value); assert.equal(s.slider, value);
  assert.notEqual(s.alpha, null, 'Output summary panel must be mounted');
  assert(Math.abs(s.alpha - value) < 0.01, `Output panel alpha must be ${value}, got ${s.alpha}`);
  assert.equal(s.opacity, '1', 'Panel contents must not fade');
  assert(s.headers.length > 0 && s.headers.every(values => values.every(a => a === 0)), 'Headers and their pseudo-elements must not compound opacity');
  assert(s.buttons > 0, 'Output-panel actions remain mounted');
}
async function setControl(value) {
  await evaluate(`(() => { const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')].find(e => e.textContent.includes('输出内容浮窗不透明度')); const r = row.querySelector('input[type="range"]'); r.value = '${value}'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
let original;
try {
  await evaluate('window.__zcodeBgUi.open()');
  const initial = await evaluate(sample); console.log(JSON.stringify(initial, null, 2)); original = initial.value; verify(initial, original);
  if (process.argv.includes('--exercise')) {
    for (const value of [0.5, 1]) {
      await setControl(value);
      const s = await evaluate(sample); verify(s, value); assert.deepEqual(s.independent, initial.independent);
      await delay(3000); verify(await evaluate(sample), value);
      assert.equal(JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')).outputAlpha, value);
    }
    await evaluate(`(() => { const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')].find(e => e.textContent.includes('输出内容浮窗不透明度')); [...row.querySelectorAll('button')].find(e => e.textContent === '与聊天区一致').click(); })()`);
    await delay(3000); verify(await evaluate(sample), 0);
    assert.equal(JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')).outputAlpha, 0);
  }
  console.log('PASS: independent output-panel background, transparent headers, slider and reset' + (process.argv.includes('--exercise') ? ', preview and persistence' : ''));
} finally {
  if (original !== undefined && process.argv.includes('--exercise')) { await setControl(original); await delay(1000); }
  ws.close();
}
