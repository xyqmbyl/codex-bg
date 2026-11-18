// 检查页面里注入的版本与播放器状态
import { setTimeout as delay } from "node:timers/promises";

const list = await (await fetch("http://127.0.0.1:9224/json")).json();
const t = list.find((x) => x && x.webSocketDebuggerUrl && x.url === "app://-/index.html");
if (!t) { console.log("NO-TARGET"); process.exit(1); }
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));
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
    delay(30000).then(() => { throw new Error(method + ": timeout"); }),
  ]);
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error("page-exc: " + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r && r.result ? r.result.value : undefined;
}
await send("Runtime.enable");

const res = await evalJs(`JSON.stringify({
  ui: window.__zcodeBgUi ? window.__zcodeBgUi.version : null,
  wc: window.__zcodeBgVideoWc ? window.__zcodeBgVideoWc.__v : null,
  wcActive: window.__zcodeBgVideoWc ? window.__zcodeBgVideoWc.active() : null,
  wcPainted: window.__zcodeBgVideoWc ? window.__zcodeBgVideoWc.painted() : null,
  lastErr: window.__zcodeBgVideoWcLastErr ? String(window.__zcodeBgVideoWcLastErr).slice(0,200) : null,
  hasCanvas: !!document.getElementById("__zcode_bg_video_wc"),
})`).catch((e) => ({ outerErr: String(e).slice(0, 300) }));
console.log("state:", JSON.stringify(res).slice(0, 900));
ws.close();
process.exit(0);
