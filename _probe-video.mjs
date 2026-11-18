// 探针：video 元素 / 兜底定时器 / WC 播放器状态
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

const res = await evalJs(`(function(){
  var v = document.getElementById("__zcode_bg_video");
  var fb = document.getElementById("__zcode_bg_video_fb");
  var wc = document.getElementById("__zcode_bg_video_wc");
  return JSON.stringify({
    cfg: window.__zcodeBgVideoCfg ? { url: window.__zcodeBgVideoCfg.url, preview: !!window.__zcodeBgVideoCfg.preview, fit: window.__zcodeBgVideoCfg.fit } : null,
    videoEl: v ? { readyState: v.readyState, src: (v.src||"").slice(-60), opacity: v.style.opacity, paused: v.paused } : null,
    fb: fb ? { src: (fb.src||"").slice(-40) } : null,
    wcCanvas: wc ? { opacity: wc.style.opacity, w: wc.width, h: wc.height } : null,
    wcActive: window.__zcodeBgVideoWc ? window.__zcodeBgVideoWc.active() : null,
    wcPainted: window.__zcodeBgVideoWc ? window.__zcodeBgVideoWc.painted() : null,
    wcLastErr: window.__zcodeBgVideoWcLastErr ? String(window.__zcodeBgVideoWcLastErr).slice(0, 200) : null,
    fbTimer: window.__zcodeBgVideoFbTimer || 0,
  });
})()`);
console.log("video-state:", typeof res === "string" ? JSON.stringify(JSON.parse(res), null, 1) : JSON.stringify(res));
ws.close();
process.exit(0);
