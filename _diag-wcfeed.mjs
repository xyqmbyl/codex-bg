// 在页面里单独压测 VideoDecoder：用 wc-player.js 自己的分包器，喂全部样本，看是否卡死。
import { setTimeout as delay } from "node:timers/promises";

const EXPR = `(async function(){
  var wc = window.__zcodeBgVideoWc;
  var URL_ = (window.__zcodeBgVideoCfg && window.__zcodeBgVideoCfg.url) || "http://127.0.0.1:19765/w/ec36b23ff19476c7";
  var buf = await (await fetch(URL_)).arrayBuffer();
  var p = wc.testParse(buf);
  var stat = { samples: p.samples.length, codec: p.codec, timescale: p.timescale, durUs: p.durUs, descLen: p.desc ? p.desc.byteLength : null };
  var out = 0, err = null, ts = [];
  var dec = new VideoDecoder({
    output: function (f) { out++; ts.push(f.timestamp); try { f.close(); } catch (e) {} },
    error: function (e) { err = String(e); }
  });
  dec.configure({ codec: p.codec, description: p.desc, optimizeForLatency: true });
  var fed = 0;
  var t0 = performance.now();
  while (fed < p.samples.length && performance.now() - t0 < 8000) {
    if (dec.decodeQueueSize >= 12) { await new Promise(function (r) { setTimeout(r, 20); }); continue; }
    var sp = p.samples[fed];
    try {
      dec.decode(new EncodedVideoChunk({ type: sp.key ? "key" : "delta", timestamp: sp.pts, duration: sp.dur, data: new Uint8Array(buf, sp.off, sp.size) }));
      fed++;
    } catch (e) { err = "feed@" + fed + ": " + String(e); break; }
  }
  var midQueue = dec.decodeQueueSize;
  await new Promise(function (r) { setTimeout(r, 4000); });
  return { stat: stat, fed: fed, outAfterFeed: out, queueAfterFeed: midQueue, outAfterWait: out, queueAfterWait: dec.decodeQueueSize, state: dec.state, err: err, firstTs: ts[0], lastTs: ts[ts.length - 1], ms: Math.round(performance.now() - t0) };
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
await send("Runtime.enable");
const r = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true });
if (r && r.exceptionDetails) console.log("PAGE-EXC:", JSON.stringify(r.exceptionDetails).slice(0, 900));
console.log(JSON.stringify(r && r.result ? r.result.value : r, null, 1));
ws.close();
process.exit(0);
