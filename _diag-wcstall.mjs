// 给 wc 播放器打计数补丁后重启，观察 decode / drawImage 是否还在推进。
import { setTimeout as delay } from "node:timers/promises";

const PATCH = `(function(){
  if (!window.__zcbgPatch) {
    window.__zcbgPatch = 1;
    window.__drawCount = 0; window.__drawErr = null; window.__decodeCalls = 0; window.__owaits = 0;
    var di = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function () {
      try { var r = di.apply(this, arguments); window.__drawCount++; return r; }
      catch (e) { window.__drawErr = String(e); throw e; }
    };
    var dd = VideoDecoder.prototype.decode;
    VideoDecoder.prototype.decode = function () { window.__decodeCalls++; return dd.apply(this, arguments); };
    var of = VideoDecoder.prototype.flush;
    VideoDecoder.prototype.flush = function () { window.__owaits++; return of.apply(this, arguments); };
  }
  return "patched";
})()`;

const RESTART = `(function(){
  var wc = window.__zcodeBgVideoWc;
  var cfg = window.__zcodeBgVideoCfg;
  wc.stop();
  window.__drawCount = 0; window.__decodeCalls = 0; window.__drawErr = null;
  wc.start(cfg);
  return { cfg: cfg ? cfg.url : null };
})()`;

const SAMPLE = `(function(){
  var c = document.getElementById("__zcode_bg_video_wc");
  var mean = null;
  if (c) { var d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; var s = 0, n = 0;
    for (var i = 0; i < d.length; i += 4000) { s += d[i] + d[i + 1] + d[i + 2]; n++; } mean = Math.round(s / (3 * n)); }
  var wc = window.__zcodeBgVideoWc;
  return { draws: window.__drawCount, decodes: window.__decodeCalls, drawErr: window.__drawErr,
    mean: mean, active: wc.active(), painted: wc.painted(), err: window.__zcodeBgVideoWcLastErr || null };
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
console.log("patch:", JSON.stringify(await ev(PATCH)));
console.log("restart:", JSON.stringify(await ev(RESTART)));
for (let i = 0; i < 5; i++) {
  await delay(3000);
  console.log("t+" + (i + 1) * 3 + "s:", JSON.stringify(await ev(SAMPLE)));
}
ws.close();
process.exit(0);
