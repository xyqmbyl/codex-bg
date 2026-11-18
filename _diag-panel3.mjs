// 诊断3：用真实 id 查面板
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
    delay(10000).then(() => { throw new Error(method + ": timeout"); }),
  ]);
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r && r.exceptionDetails) throw new Error("page-exc: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r && r.result ? r.result.value : undefined;
}
await send("Runtime.enable");

await evalJs(`window.__zcodeBgUi ? (window.__zcodeBgUi.open(), "ok") : "no-ui"`);
await delay(4000);

const info = await evalJs(`(function(){
  var layer = document.getElementById("__zcode_bg_layer");
  var libs = document.querySelectorAll(".zcbg-lib");
  var items = document.querySelectorAll("button.zcbg-lib-item");
  var hints = [];
  document.querySelectorAll(".zcbg-hint").forEach(function(h){ hints.push(String(h.textContent).slice(0, 80)); });
  return {
    layerExists: !!layer,
    layerDisplay: layer ? layer.style.display : "",
    layerLen: layer ? layer.innerHTML.length : 0,
    libCount: libs.length,
    itemCount: items.length,
    hints: hints.slice(0, 5)
  };
})()`);
console.log("info:", JSON.stringify(info));
ws.close();
process.exit(0);
