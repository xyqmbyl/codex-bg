// Page.bringToFront + 播放验证
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
await send("Runtime.enable");
await send("Page.enable");
await send("Page.bringToFront").catch(() => {});
await delay(1500);
const v0 = await evalJs(`({ hidden: document.hidden, vis: document.visibilityState })`);
console.log("after bringToFront:", JSON.stringify(v0));

const expr = `(async function(){
  var v = document.getElementById("__zcode_bg_video");
  if (!v) return { err: "no el" };
  var playErr = "";
  try {
    var pr = v.play();
    if (pr && pr.catch) pr.catch(function (e) { window.__probePlayErr = String(e).slice(0, 120); });
  } catch (e) { playErr = String(e).slice(0, 120); }
  await new Promise(function (r) { setTimeout(r, 3000); });
  playErr = window.__probePlayErr || playErr;
  window.__probePlayErr = "";
  var ct1 = v.currentTime;
  await new Promise(function (r) { setTimeout(r, 2000); });
  return {
    hidden: document.hidden,
    vis: document.visibilityState,
    paused: v.paused,
    ct1: Math.round(ct1 * 100) / 100,
    ct2: Math.round(v.currentTime * 100) / 100,
    advancing: v.currentTime > ct1,
    playErr: playErr,
    rs: v.readyState,
  };
})()`;
const res = await evalJs(expr);
console.log("play:", JSON.stringify(res));
ws.close();
process.exit(0);
