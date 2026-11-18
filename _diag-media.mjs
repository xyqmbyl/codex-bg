// 这个壳到底能解什么：canPlayType 广告 + 一个极小的合成 WAV（PCM 静音）能不能出 canplay。
import { setTimeout as delay } from "node:timers/promises";

const EXPR = `(async function(){
  var v = document.createElement("video");
  var ct = {
    mp4_avc: v.canPlayType('video/mp4; codecs="avc1.640033"'),
    mp4: v.canPlayType("video/mp4"),
    webm: v.canPlayType("video/webm"),
    wav: v.canPlayType("audio/wav"),
    mp3: v.canPlayType("audio/mpeg"),
    aac: v.canPlayType('audio/mp4; codecs="mp4a.40.2"')
  };
  // 合成 0.1s / 8000Hz / 8bit 单声道 PCM 静音 WAV
  var n = 800, bytes = new Uint8Array(44 + n);
  function ws(off, s) { for (var i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); }
  ws(0, "RIFF"); new DataView(bytes.buffer).setUint32(4, 36 + n, true); ws(8, "WAVEfmt ");
  new DataView(bytes.buffer).setUint32(16, 16, true); bytes[20] = 1; bytes[22] = 1;
  new DataView(bytes.buffer).setUint32(24, 8000, true); new DataView(bytes.buffer).setUint32(28, 8000, true);
  bytes[32] = 1; bytes[34] = 8; ws(36, "data"); new DataView(bytes.buffer).setUint32(40, n, true);
  for (var i = 0; i < n; i++) bytes[44 + i] = 128;
  var url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  var a = document.createElement("audio");
  a.src = url;
  var ev = await new Promise(function (res) {
    var done = false;
    function fin(k) { if (!done) { done = true; res(k); } }
    a.oncanplay = function () { fin("canplay"); };
    a.onloadedmetadata = function () { fin("loadedmetadata"); };
    a.onerror = function () { fin("error:" + (a.error ? a.error.code + ":" + a.error.message : "?")); };
    setTimeout(function () { fin("timeout"); }, 4000);
    try { a.play(); } catch (e) { fin("play-throw:" + String(e)); }
  });
  return { canPlayType: ct, wavEvent: ev, wavReadyState: a.readyState, wavDur: a.duration, wavNetwork: a.networkState, mediaSource: typeof MediaSource !== "undefined", pcm16: typeof AudioDecoder !== "undefined" };
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
if (r && r.exceptionDetails) console.log("PAGE-EXC:", JSON.stringify(r.exceptionDetails).slice(0, 500));
console.log(JSON.stringify(r && r.result ? r.result.value : r, null, 1));
ws.close();
process.exit(0);
