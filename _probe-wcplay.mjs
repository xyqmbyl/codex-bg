// WC 播放器端到端：start → painted → canvas 像素变化 → stop 还原
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
  if (r && r.exceptionDetails) throw new Error("page-exc: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r && r.result ? r.result.value : undefined;
}
await send("Page.enable");
await send("Runtime.enable");
await send("Page.bringToFront").catch(() => {});
await delay(1200);

const expr = `(async function(){
  var wc = window.__zcodeBgVideoWc;
  if (!wc) return { err: "no wc" };
  wc.start({ url: "http://127.0.0.1:19765/w/ec36b23ff19476c7", fit: "cover", align: "center" });
  await new Promise(function (r) { setTimeout(r, 5000); });
  var c = document.getElementById("__zcode_bg_video_wc");
  if (!c) return { active: window.__zcodeBgVideoWc.active(), canvas: false, lastErr: window.__zcodeBgVideoWcLastErr || "" };
  function sig() {
    var ctx = c.getContext("2d");
    var d = ctx.getImageData(Math.floor(c.width / 4), Math.floor(c.height / 4), 64, 64).data;
    var s = 0;
    for (var i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2];
    return s;
  }
  var s1 = sig();
  await new Promise(function (r) { setTimeout(r, 2500); });
  var s2 = sig();
  var out = { hidden: document.hidden, active: window.__zcodeBgVideoWc.active(), painted: window.__zcodeBgVideoWc.painted(), canvas: !!c, opacity: c.style.opacity, w: c.width, h: c.height, s1: s1, s2: s2, pixelsChanged: s2 !== s1, lastErr: window.__zcodeBgVideoWcLastErr || "" };
  window.__zcodeBgVideoWc.stop();
  out.stopped = !window.__zcodeBgVideoWc.active();
  return out;
})()`;
const res = await evalJs(expr);
console.log("wc-e2e:", JSON.stringify(res));
ws.close();
process.exit(0);
