// 截图（可带 clip）+ 逐点比较：node _shot.mjs <out.png> [x,y,w,h]
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const out = process.argv[2] || "shot.png";
const clip = process.argv.length >= 7 ? { x: +process.argv[3], y: +process.argv[4], width: +process.argv[5], height: +process.argv[6], scale: 1 } : undefined;
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
    delay(20000).then(() => { throw new Error(method + ": timeout"); }),
  ]);
}
await send("Page.enable");
const shot = await send("Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("saved", out, "bytes", Buffer.from(shot.data, "base64").length);
ws.close();
process.exit(0);
