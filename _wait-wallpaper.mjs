// Wait for the full chain after clicking a taskbar Codex icon, and report timings.
//   node _wait-wallpaper.mjs [timeoutSec]
// Prints:  port +Xs   page +Xs   wallpaper +Xs   (or FAIL with what was missing)
// ASCII only on purpose.
import { setTimeout as delay } from "node:timers/promises";

const timeoutSec = Number(process.argv[2] || 120);
const t0 = Date.now();
const el = () => "+" + ((Date.now() - t0) / 1000).toFixed(1) + "s";
const PORT = 9224;

async function portUp() {
  try {
    const r = await fetch("http://127.0.0.1:" + PORT + "/json/version", { signal: AbortSignal.timeout(1500) });
    return r.status === 200;
  } catch {
    return false;
  }
}

// port
let portAt = null;
while (Date.now() - t0 < timeoutSec * 1000) {
  if (await portUp()) { portAt = el(); console.log("port      " + portAt); break; }
  await delay(500);
}
if (!portAt) { console.log("FAIL: port " + PORT + " never opened within " + timeoutSec + "s"); process.exit(1); }

// main page target
let target = null;
let pageAt = null;
while (Date.now() - t0 < timeoutSec * 1000) {
  try {
    const list = await (await fetch("http://127.0.0.1:" + PORT + "/json", { signal: AbortSignal.timeout(2000) })).json();
    const t = list.find((x) => x && x.webSocketDebuggerUrl && x.url === "app://-/index.html");
    if (t) { target = t; pageAt = el(); console.log("page      " + pageAt); break; }
  } catch { /* list request itself can fail/hang while stuck */ }
  await delay(1000);
}
if (!pageAt) { console.log("FAIL: main page target app://-/index.html never appeared within " + timeoutSec + "s"); process.exit(1); }

// injection marker
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params = {}) {
  return Promise.race([
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    }),
    delay(15000).then(() => { throw new Error(method + ": timeout"); }),
  ]);
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error("page-exc: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r && r.result ? r.result.value : undefined;
}
await send("Runtime.enable");

const marker = `JSON.stringify({
  ui: (window.__zcodeBgUi && window.__zcodeBgUi.version) || null,
  bg: getComputedStyle(document.documentElement).backgroundImage !== "none",
  video: !!document.getElementById("__zcode_bg_video"),
  ready: (function(){ var v = document.getElementById("__zcode_bg_video"); return v ? v.readyState : null; })(),
  w: (function(){ var v = document.getElementById("__zcode_bg_video"); return v ? v.videoWidth : null; })()
})`;

let injectedAt = null;
let last = null;
while (Date.now() - t0 < timeoutSec * 1000) {
  try {
    last = JSON.parse(await evalJs(marker));
    if (last.ui || last.bg || last.video) { injectedAt = el(); break; }
  } catch (e) { last = { err: String(e).slice(0, 200) }; }
  await delay(1000);
}
ws.close();
if (!injectedAt) { console.log("FAIL: no injection trace within " + timeoutSec + "s  last=" + JSON.stringify(last)); process.exit(1); }
console.log("wallpaper " + injectedAt + "  " + JSON.stringify(last));
console.log("OK port=" + portAt + " page=" + pageAt + " wallpaper=" + injectedAt);
process.exit(0);
