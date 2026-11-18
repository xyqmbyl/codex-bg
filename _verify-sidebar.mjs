// Live regression: open a Codex conversation, then run node _verify-sidebar.mjs.
// --exercise also tests the real slider, saving, and the reset button, then leaves 0%.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
const target = targets.find(t => t.url === 'app://-/index.html');
assert(target, 'Codex main window must be open');
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
ws.onmessage = event => { const reply = JSON.parse(event.data); pending.get(reply.id)?.(reply); };
async function evaluate(expression) {
  const id = ++nextId;
  let timer;
  try {
    const reply = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP timeout')), 10000);
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    assert(!reply.error && !reply.result.exceptionDetails, JSON.stringify(reply.error || reply.result.exceptionDetails));
    return reply.result.result.value;
  } finally { clearTimeout(timer); pending.delete(id); }
}
const sample = `(() => {
  const sidebar = document.querySelector('#app-shell-sidebar [data-sidebar-navigation-root]');
  const main = document.querySelector('main');
  const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')]
    .find(e => e.textContent.includes('左侧栏不透明度'));
  const range = row?.querySelector('input[type="range"]');
  const color = sidebar && getComputedStyle(sidebar).backgroundColor;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d'); context.fillStyle = color || 'transparent'; context.fillRect(0, 0, 1, 1);
  return { version: window.__zcodeBgUi?.version, value: window.__zcodeBgUi?.state.sidebarAlpha,
    panelAlpha: window.__zcodeBgUi?.state.panelAlpha, alpha: context.getImageData(0, 0, 1, 1).data[3] / 255,
    opacity: sidebar && getComputedStyle(sidebar).opacity,
    textOpacity: sidebar?.querySelector('.sidebar-item') && getComputedStyle(sidebar.querySelector('.sidebar-item')).opacity,
    mainBackground: main && getComputedStyle(main).background,
    range: range ? { value: Number(range.value), min: range.min, max: range.max, label: range.getAttribute('aria-label') } : null,
    reset: !!row && [...row.querySelectorAll('button')].some(b => b.textContent === '与聊天区一致') };
})()`;
function verify(state, alpha) {
  assert(state.range, 'Wallpaper settings must contain an independent sidebar slider');
  assert(state.reset, 'Wallpaper settings must contain a reset-to-chat button');
  assert.equal(state.range.label, '左侧栏不透明度');
  assert.equal(state.value, alpha, 'UI state must retain the independent sidebar opacity');
  assert.equal(state.range.value, alpha, 'Slider must reflect saved state');
  assert(Math.abs(state.alpha - alpha) < 0.01, `Sidebar background alpha: expected ${alpha}, got ${state.alpha}`);
  assert.equal(state.opacity, '1', 'Sidebar contents must not fade');
  assert.equal(state.textOpacity, '1', 'Sidebar labels must not fade');
}
try {
  await evaluate('window.__zcodeBgUi.open()');
  const initial = await evaluate(sample);
  console.log(JSON.stringify(initial, null, 2));
  verify(initial, 0);
  if (process.argv.includes('--exercise')) {
    for (const value of [0.5, 1]) {
      await evaluate(`(() => { const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')].find(e => e.textContent.includes('左侧栏不透明度')); const r = row.querySelector('input[type="range"]'); r.value = '${value}'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      const immediate = await evaluate(sample);
      verify(immediate, value);
      assert.equal(immediate.mainBackground, initial.mainBackground, 'Sidebar preview must not change the chat surface');
      assert.equal(immediate.panelAlpha, initial.panelAlpha, 'Sidebar must not change general panel opacity');
      await delay(1800);
      assert.equal(JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')).sidebarAlpha, value, 'Slider change must persist to disk');
      verify(await evaluate(sample), value);
    }
    await evaluate(`(() => { const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')].find(e => e.textContent.includes('左侧栏不透明度')); [...row.querySelectorAll('button')].find(b => b.textContent === '与聊天区一致').click(); })()`);
    await delay(1800);
    verify(await evaluate(sample), 0);
    assert.equal(JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8')).sidebarAlpha, 0);
  }
  console.log('PASS: independent sidebar opacity; readable labels; slider and reset' + (process.argv.includes('--exercise') ? '; live preview and persistence' : ''));
} finally { ws.close(); }
