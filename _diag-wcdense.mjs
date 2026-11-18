// 密集采样：间隔 N 秒的全画布差异（默认 4 秒），用来看真实运动幅度。
import { setTimeout as delay } from "node:timers/promises";

const gap = Number(process.argv[2] || 4000);
const SNAP = `(function(){
  var c = document.getElementById("__zcode_bg_video_wc");
  if (!c) return null;
  window.__snapData = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  return { w: c.width, h: c.height, bytes: window.__snapData.length };
})()`;
const DIFF = `(function(){
  var c = document.getElementById("__zcode_bg_video_wc");
  if (!c) return null;
  var prev = window.__snapData;
  var d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  var n = 0, big = 0, acc = 0;
  for (var i = 0; i < d.length; i += 40) {
    n++;
    var dd = Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]);
    acc += dd;
    if (dd > 30) big++;
  }
  return { n: n, meanDiff: Math.round(acc / n * 100) / 100, changedPct: Math.round(1000 * big / n) / 10 };
})()`;

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
  return new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return "PAGE-EXC: " + JSON.stringify(r.exceptionDetails).slice(0, 400);
  return r && r.result ? r.result.value : r;
}
await send("Runtime.enable");
console.log("snap:", JSON.stringify(await ev(SNAP)));
await delay(gap);
console.log("diff@" + gap + "ms:", JSON.stringify(await ev(DIFF)));
await ev(SNAP);
await delay(gap);
console.log("diff@" + gap + "ms:", JSON.stringify(await ev(DIFF)));
ws.close();
process.exit(0);
