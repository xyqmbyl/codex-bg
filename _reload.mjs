// 重载页面目标（用于清掉探针注入的原型补丁），重载后注入器的
// Page.addScriptToEvaluateOnNewDocument 会自动把壁纸重新注入。
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
  return new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
await send("Runtime.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: false });
console.log("reload requested");
const t0 = Date.now();
while (Date.now() - t0 < 25000) {
  await delay(2000);
  try {
    const r = await send("Runtime.evaluate", {
      expression: "JSON.stringify({url:location.href, ready:document.readyState, ui:!!window.__zcodeBgUi, wc:!!window.__zcodeBgVideoWc, wcv:window.__zcodeBgVideoWc?window.__zcodeBgVideoWc.__v:null, video:!!document.getElementById('__zcode_bg_video'), patches:!!window.__zcbgPatch})",
      returnByValue: true,
    });
    const v = r && r.result ? r.result.value : null;
    console.log("+" + Math.round((Date.now() - t0) / 1000) + "s:", v);
    if (v && v.includes('"ui":true') && v.includes('"video":true')) break;
  } catch (e) {
    console.log("+" + Math.round((Date.now() - t0) / 1000) + "s: err", String(e).slice(0, 120));
  }
}
ws.close();
process.exit(0);
