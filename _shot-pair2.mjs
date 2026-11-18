// bringToFront → 布局指标 → 截图 ×2（同连接，间隔 2.5s）→ 校验
import { setTimeout as delay } from "node:timers/promises";
import { writeFileSync } from "node:fs";

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
await delay(1500);

const vis = await evalJs(`({ hidden: document.hidden, vis: document.visibilityState, iw: window.innerWidth, ih: window.innerHeight, dpr: window.devicePixelRatio })`);
console.log("vis:", JSON.stringify(vis));

const shot1 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("verify-we-video-A.png", Buffer.from(shot1.data, "base64"));
await delay(2500);
const visMid = await evalJs(`({ hidden: document.hidden, paused: (function(){ var v = document.getElementById("__zcode_bg_video"); return v ? v.paused : null; })(), ct: (function(){ var v = document.getElementById("__zcode_bg_video"); return v ? Math.round(v.currentTime * 100) / 100 : null; })() })`);
console.log("mid:", JSON.stringify(visMid));
const shot2 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("verify-we-video-B.png", Buffer.from(shot2.data, "base64"));
console.log("saved A/B");
ws.close();
process.exit(0);
