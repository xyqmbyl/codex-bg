// 通用页面探针：node _probe.mjs "<expr>" [timeoutMs]
import { setTimeout as delay } from "node:timers/promises";

const expr = process.argv[2];
const timeout = Number(process.argv[3] || 60000);
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
    delay(timeout).then(() => { throw new Error(method + ": timeout"); }),
  ]);
}
await send("Runtime.enable");
const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
if (r && r.exceptionDetails) console.log("PAGE-EXC:", JSON.stringify(r.exceptionDetails).slice(0, 800));
console.log(JSON.stringify(r && r.result ? r.result.value : r));
ws.close();
process.exit(0);
