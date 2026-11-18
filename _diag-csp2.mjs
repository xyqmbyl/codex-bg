// 用「头像浮层」这个未被注入器 attach 的 page 目标做 CSP 对照：
// 若它的 meta CSP(default-src 'none') 生效，则同源页面里 fetch / blob 媒体都会被拦，
// 这就能解释主窗口早期 <video> readyState 恒 0（不是解码器缺失）。只读探测，不动主窗口。
const EXPR = `(async function(){
  var m = document.querySelector('meta[http-equiv="Content-Security-Policy" i]');
  var out = { url: location.href, csp: m ? m.getAttribute("content") : null, injected: !!(window.__zcodeBg || window.__zcodeBgUi) };
  out.fetch = await fetch("http://127.0.0.1:19765/w/ec36b23ff19476c7", { method: "GET", headers: { Range: "bytes=0-15" } })
    .then(function (r) { return "ok:" + r.status; })
    .catch(function (e) { return "fail:" + String(e).slice(0, 90); });
  var n = 800, bytes = new Uint8Array(44 + n);
  function ws(o, s) { for (var i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); }
  ws(0, "RIFF"); new DataView(bytes.buffer).setUint32(4, 36 + n, true); ws(8, "WAVEfmt ");
  new DataView(bytes.buffer).setUint32(16, 16, true); bytes[20] = 1; bytes[22] = 1;
  new DataView(bytes.buffer).setUint32(24, 8000, true); new DataView(bytes.buffer).setUint32(28, 8000, true);
  bytes[32] = 1; bytes[34] = 8; ws(36, "data"); new DataView(bytes.buffer).setUint32(40, n, true);
  for (var i = 0; i < n; i++) bytes[44 + i] = 128;
  var a = document.createElement("audio");
  a.src = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  out.blobMedia = await new Promise(function (res) {
    var done = false;
    function fin(k) { if (!done) { done = true; res(k); } }
    a.oncanplay = function () { fin("canplay"); };
    a.onloadedmetadata = function () { fin("loadedmetadata"); };
    a.onerror = function () { fin("error:" + (a.error ? a.error.code + ":" + a.error.message : "?")); };
    setTimeout(function () { fin("timeout"); }, 3500);
    a.load();
  });
  out.blobReadyState = a.readyState;
  return out;
})()`;

const list = await (await fetch("http://127.0.0.1:9224/json")).json();
const t = list.find((x) => x && x.webSocketDebuggerUrl && String(x.url).startsWith("app://") && x.url !== "app://-/index.html");
if (!t) { console.log("NO-SECOND-TARGET", JSON.stringify(list.map((x) => x.url))); process.exit(1); }
console.log("target:", t.url);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));
let id = 0;
const pend = new Map();
ws.onmessage = (ev) => { const d = JSON.parse(ev.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
await send("Runtime.enable");
const r = await send("Runtime.evaluate", { expression: EXPR, returnByValue: true, awaitPromise: true });
if (r && r.exceptionDetails) console.log("PAGE-EXC:", JSON.stringify(r.exceptionDetails).slice(0, 400));
console.log(JSON.stringify(r && r.result ? r.result.value : r, null, 1));
ws.close();
process.exit(0);
