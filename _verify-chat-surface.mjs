// Run with an open Codex conversation: node _verify-chat-surface.mjs
// Include pointer-events:none layers and footer pseudo-elements missed by hit testing.
import assert from 'node:assert/strict';

const targets = await (await fetch('http://127.0.0.1:9224/json/list')).json();
const target = targets.find(t => t.url === 'app://-/index.html');
assert(target, 'Codex main window must be open');
const ws = new WebSocket(target.webSocketDebuggerUrl);
const timer = setTimeout(() => { ws.close(); throw new Error('CDP timeout'); }, 10000);
try {
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const reply = new Promise(resolve => {
    ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id === 1) resolve(message); };
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
    returnByValue: true,
    expression: `(() => {
      const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const read = (e, pseudo = null) => { const s = getComputedStyle(e, pseudo), r = e.getBoundingClientRect();
        return { className: e.className, pseudo, background: s.backgroundColor, image: s.backgroundImage,
          pointerEvents: s.pointerEvents, content: s.content, width: r.width, height: r.height }; };
      const footer = [...document.querySelectorAll(':is([class^="footer-"],[class*=" footer-"],[class*="_footer_"]):has([data-composer-surface-variant])')].find(visible);
      const layout = document.querySelector('[class~="group/thread-scroll-layout"]');
      const layers = layout ? [...layout.querySelectorAll('[class*="_background_"],[class*="background-"]')]
        .filter(e => /_(surface|fade)_|(?:surface|fade)-/.test(e.className) && visible(e)).map(e => read(e)) : [];
      if (footer) layers.push(read(footer, '::before'), read(footer, '::after'));
      const composer = [...document.querySelectorAll('[data-composer-surface-variant]')].find(visible);
      return { version: window.__zcodeBgUi?.version, layers,
        composer: composer ? { background: getComputedStyle(composer).backgroundColor,
          height: composer.getBoundingClientRect().height,
          editable: !!composer.querySelector('[contenteditable="true"],textarea') } : null };
    })()`
  }}));
  const result = await reply;
  assert(!result.error && !result.result?.exceptionDetails, JSON.stringify(result.error || result.result?.exceptionDetails));
  const state = result.result.result.value;
  console.log(JSON.stringify(state, null, 2));
  assert(state.layers.length >= 2, 'Conversation bottom surface and fade must be detected');
  for (const layer of state.layers) {
    assert(layer.width > 0 && layer.height > 0, 'Background layer geometry must remain intact');
    assert.equal(layer.background, 'rgba(0, 0, 0, 0)', 'Conversation bottom background must reveal wallpaper');
    assert.equal(layer.image, 'none', 'Conversation bottom gradient must reveal wallpaper');
  }
  assert(state.composer?.height > 0 && state.composer.editable, 'Composer must retain its layout and editor');
  console.log('PASS: conversation bottom reveals wallpaper; composer retains its layout and editor');
} finally {
  clearTimeout(timer);
  ws.close();
}
