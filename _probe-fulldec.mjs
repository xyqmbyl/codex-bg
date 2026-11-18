// 全量解码验证：shixiang.mp4 全部样本喂入，统计输出帧数（v45 分包器 + v3 wc 解析）
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
    delay(180000).then(() => { throw new Error(method + ": timeout"); }),
  ]);
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error("page-exc: " + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r && r.result ? r.result.value : undefined;
}
await send("Runtime.enable");

const expr = `(async function(){
  var buf = await (await fetch("http://127.0.0.1:19765/w/ec36b23ff19476c7")).arrayBuffer();
  var mp4 = window.__zcodeBgVideoWc.testParse(buf);
  var outs = 0, errAt = -1, errMsg = "";
  var dec = new VideoDecoder({
    output: function (fr) { outs++; try { fr.close(); } catch (e) {} },
    error: function (er) { errAt = fed; errMsg = String(er); },
  });
  var fed = 0;
  dec.configure({ codec: mp4.codec, description: mp4.desc });
  var t0 = performance.now();
  for (var i = 0; i < mp4.samples.length; i++) {
    if (dec.state === "closed") break;
    var s = mp4.samples[i];
    try {
      dec.decode(new EncodedVideoChunk({ type: s.key ? "key" : "delta", timestamp: s.pts, duration: s.dur, data: new Uint8Array(buf, s.off, s.size) }));
      fed++;
    } catch (e) { errAt = i; errMsg = "chunk:" + String(e).slice(0, 60); break; }
    if (dec.decodeQueueSize > 16) await new Promise(function (r) { setTimeout(r, 5); });
  }
  var fl = "ok";
  try { await dec.flush(); } catch (e) { fl = "x:" + String(e).slice(0, 40); }
  return { samples: mp4.samples.length, durMs: Math.round(mp4.durUs / 1000), fed: fed, outs: outs, errAt: errAt, errMsg: errMsg, flush: fl, ms: Math.round(performance.now() - t0) };
})()`;
const res = await evalJs(expr);
console.log("full-decode:", JSON.stringify(res));
ws.close();
process.exit(0);
