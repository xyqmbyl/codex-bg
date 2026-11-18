// 对照实验：把原生 <video>（已确认在播）画进离屏 canvas，用同一套密集采样测运动幅度，
// 用来判断“wc canvas 4 秒只变 0.2%”到底是画面本身几乎静止，还是 wc 绘制没跟上。
import { setTimeout as delay } from "node:timers/promises";

const SETUP = `(async function(){
  var cfg = window.__zcodeBgVideoCfg;
  var v = document.getElementById("__zcbg_ctrl_video");
  if (!v) {
    v = document.createElement("video");
    v.id = "__zcbg_ctrl_video";
    v.crossOrigin = "anonymous"; // 否则画进 canvas 会污染，getImageData 抛 SecurityError
    v.src = cfg.url; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
    v.style.cssText = "position:fixed;left:-2000px;top:0;width:320px;height:180px;";
    document.body.appendChild(v);
  }
  try { await v.play(); } catch (e) {}
  var c = document.getElementById("__zcbg_ctrl_canvas");
  if (!c) { c = document.createElement("canvas"); c.id = "__zcbg_ctrl_canvas"; c.width = 960; c.height = 540; }
  window.__zcbgCtrl = { v: v, c: c, ctx: c.getContext("2d") };
  return { rs: v.readyState, vw: v.videoWidth, ct: v.currentTime };
})()`;

const SNAP = `(function(){
  var g = window.__zcbgCtrl; g.ctx.drawImage(g.v, 0, 0, g.c.width, g.c.height);
  window.__ctrlData = g.ctx.getImageData(0, 0, g.c.width, g.c.height).data;
  return { ct: g.v.currentTime, bytes: window.__ctrlData.length, frames: g.v.getVideoPlaybackQuality ? g.v.getVideoPlaybackQuality().totalVideoFrames : null };
})()`;

const DIFF = `(function(){
  var g = window.__zcbgCtrl; g.ctx.drawImage(g.v, 0, 0, g.c.width, g.c.height);
  var d = g.ctx.getImageData(0, 0, g.c.width, g.c.height).data;
  var prev = window.__ctrlData, n = 0, big = 0, acc = 0;
  for (var i = 0; i < d.length; i += 40) {
    n++;
    var dd = Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]);
    acc += dd; if (dd > 30) big++;
  }
  return { n: n, meanDiff: Math.round(acc / n * 100) / 100, changedPct: Math.round(1000 * big / n) / 10, ct: g.v.currentTime };
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
console.log("setup:", JSON.stringify(await ev(SETUP)));
await delay(1500);
console.log("snap:", JSON.stringify(await ev(SNAP)));
for (let i = 0; i < 3; i++) {
  await delay(4000);
  console.log("ctrlDiff4s:", JSON.stringify(await ev(DIFF)));
  await ev(SNAP);
}
ws.close();
process.exit(0);
