// Live checks for the composer and its Add menu. --exercise tests 50%/100% and reset, then restores saved values.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
const target = targets.find(t => t.url === 'app://-/index.html');
assert(target, 'Codex main window must be open');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(); let id = 0;
ws.onmessage = event => { const r = JSON.parse(event.data); pending.get(r.id)?.(r); };
async function evaluate(expression) {
  const n = ++id; let timer;
  try {
    const r = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP timeout')), 10000); pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    assert(!r.error && !r.result.exceptionDetails, JSON.stringify(r.error || r.result.exceptionDetails));
    return r.result.result.value;
  } finally { clearTimeout(timer); pending.delete(n); }
}
const labels = { composerAlpha: '输入框不透明度', menuAlpha: '添加菜单不透明度' };
const sample = `(async () => {
  const ui = window.__zcodeBgUi, b = document.querySelector('button[aria-label="添加文件等内容"]');
  ui.close(); if (b.getAttribute('aria-expanded') !== 'true') b.click();
  await new Promise(r => setTimeout(r, 250));
  const root = document.querySelector('[data-composer-surface-variant][data-composer-layout]');
  const body = root?.querySelector('[data-composer-body]');
  const menu = document.querySelector('[data-composer-overlay-floating-ui] [class*="_suggestionMenu_"]');
  const alpha = e => { if (!e) return null; const c = document.createElement('canvas'); c.width = c.height = 1;
    const x = c.getContext('2d'); x.fillStyle = getComputedStyle(e).backgroundColor; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data[3] / 255; };
  const rows = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')];
  const controls = Object.fromEntries(Object.entries(${JSON.stringify(labels)}).map(([key, label]) => {
    const row = rows.find(e => e.textContent.includes(label)), range = row?.querySelector('input[type="range"]');
    return [key, { value: ui.state[key], slider: range ? Number(range.value) : null, label: range?.getAttribute('aria-label'),
      reset: !!row && [...row.querySelectorAll('button')].some(e => e.textContent === '与聊天区一致') }]; }));
  return { controls, composer: { alpha: alpha(root), bodyAlpha: alpha(body), opacity: root && getComputedStyle(root).opacity,
    height: root?.getBoundingClientRect().height, editable: !!root?.querySelector('[contenteditable="true"]') },
    menu: { alpha: alpha(menu), headers: menu ? [...menu.querySelectorAll('div.sticky')].map(alpha) : [],
      opacity: menu && getComputedStyle(menu).opacity, buttons: menu?.querySelectorAll('button').length },
    sidebarAlpha: ui.state.sidebarAlpha, panelAlpha: ui.state.panelAlpha };
})()`;
function verify(s, composer, menu) {
  for (const [key, label] of Object.entries(labels)) {
    assert.notEqual(s.controls[key].slider, null, `${label} slider must exist`);
    assert.equal(s.controls[key].label, label); assert(s.controls[key].reset, `${label} reset button must exist`);
    const expected = key === 'composerAlpha' ? composer : menu;
    assert.equal(s.controls[key].value, expected); assert.equal(s.controls[key].slider, expected);
  }
  assert(Math.abs(s.composer.alpha - composer) < 0.01, `Composer alpha must be ${composer}, got ${s.composer.alpha}`);
  assert.equal(s.composer.bodyAlpha, 0, 'Nested composer background must not compound opacity or retain legacy custom CSS');
  assert.equal(s.composer.opacity, '1'); assert(s.composer.height > 0 && s.composer.editable, 'Composer remains editable');
  assert(Math.abs(s.menu.alpha - menu) < 0.01, `Add menu alpha must be ${menu}, got ${s.menu.alpha}`);
  assert(s.menu.headers.length > 0 && s.menu.headers.every(a => a === 0), 'Sticky menu headings must not cover the wallpaper');
  assert.equal(s.menu.opacity, '1'); assert(s.menu.buttons > 3, 'Menu actions remain available');
}
async function setControl(key, value) {
  await evaluate(`(() => { const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')].find(e => e.textContent.includes(${JSON.stringify(labels[key])})); const r = row.querySelector('input[type="range"]'); r.value = '${value}'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}
let original;
try {
  await evaluate('window.__zcodeBgUi.open(); window.__zcodeBgUi.close()');
  const initial = await evaluate(sample); console.log(JSON.stringify(initial, null, 2));
  original = { composerAlpha: initial.controls.composerAlpha.value, menuAlpha: initial.controls.menuAlpha.value };
  verify(initial, original.composerAlpha, original.menuAlpha);
  if (process.argv.includes('--exercise')) {
    for (const [key, label] of Object.entries(labels)) {
      for (const value of [0.5, 1]) {
        await setControl(key, value);
        let s = await evaluate(sample); verify(s, key === 'composerAlpha' ? value : original.composerAlpha, key === 'menuAlpha' ? value : original.menuAlpha);
        assert.equal(s.sidebarAlpha, initial.sidebarAlpha); assert.equal(s.panelAlpha, initial.panelAlpha);
        // Allow the 2.5s config watcher to finish its re-injection before the next independent action.
        await delay(3000);
        assert.equal(JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'))[key], value, `${label} must save`);
        verify(await evaluate(sample), key === 'composerAlpha' ? value : original.composerAlpha, key === 'menuAlpha' ? value : original.menuAlpha);
      }
      await evaluate(`(() => { const row = [...document.querySelectorAll('#__zcode_bg_layer .zcbg-row')].find(e => e.textContent.includes(${JSON.stringify(label)})); [...row.querySelectorAll('button')].find(e => e.textContent === '与聊天区一致').click(); })()`);
      await delay(3000); verify(await evaluate(sample), key === 'composerAlpha' ? 0 : original.composerAlpha, key === 'menuAlpha' ? 0 : original.menuAlpha);
      assert.equal(JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'))[key], 0);
      if (original[key] !== 0) { await setControl(key, original[key]); await delay(3000); }
    }
    // An older injection's 4-second retry must not undo the restored settings.
    await delay(4500); verify(await evaluate(sample), original.composerAlpha, original.menuAlpha);
  }
  console.log('PASS: independent composer/menu backgrounds, legacy CSS precedence, transparent headings, live controls' + (process.argv.includes('--exercise') ? ', preview and persistence' : ''));
} finally {
  if (original && process.argv.includes('--exercise')) {
    for (const [key, value] of Object.entries(original)) await setControl(key, value);
    await delay(1000);
  }
  ws.close();
}
