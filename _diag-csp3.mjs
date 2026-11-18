// 决定性 A/B：关掉本会话的 CSP bypass 后，在已加载的文档里新建 <video> 试三种 URL
//   http://127.0.0.1:19765/... （媒体服务：页面 CSP 的 media-src 里只有 'self' app: blob: data: https:，没有 http:）
//   blob: / data: 的极小 WAV（media-src 明确允许）
// 探测完无论如何恢复 bypass=true，并且不 reload 页面。
const TARGET = "app://-/index.html";
const URL_MP4 = "http://127.0.0.1:19765/w/ec36b23ff19476c7";

const mkTest = (kind) => `(async function(){
  var u;
  if ("${kind}" === "http") u = ${JSON.stringify(URL_MP4)};
  else {
    var n = 800, bytes = new Uint8Array(44 + n);
    function ws(o, s) { for (var i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); }
    ws(0, "RIFF"); new DataView(bytes.buffer).setUint32(4, 36 + n, true); ws(8, "WAVEfmt ");
    new DataView(bytes.buffer).setUint32(16, 16, true); bytes[20] = 1; bytes[22] = 1;
    new DataView(bytes.buffer).setUint32(24, 8000, true); new DataView(bytes.buffer).setUint32(28, 8000, true);
    bytes[32] = 1; bytes[34] = 8; ws(36, "data"); new DataView(bytes.buffer).setUint32(40, n, true);
    for (var i = 0; i < n; i++) bytes[44 + i] = 128;
    u = "${kind}" === "blob"
      ? URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }))
      : "data:audio/wav;base64," + btoa(String.fromCharCode.apply(null, bytes));
  }
  var el = document.createElement("video");
  el.muted = true;
  el.src = u;
  var ev = await new Promise(function (res) {
    var done = false;
    function fin(k) { if (!done) { done = true; res(k); } }
    el.onloadedmetadata = function () { fin("loadedmetadata"); };
    el.oncanplay = function () { fin("canplay"); };
    el.onerror = function () { fin("error:code=" + (el.error ? el.error.code : "?") + ":" + (el.error ? el.error.message : "")); };
    setTimeout(function () { fin("timeout"); }, 4000);
    el.load();
  });
  var out = { kind: "${kind}", ev: ev, readyState: el.readyState, networkState: el.networkState, scheme: u.slice(0, 12) };
  el.removeAttribute("src"); el.load(); el.remove();
  return out;
})()`;

const list = await (await fetch("http://127.0.0.1:9224/json")).json();
const t = list.find((x) => x && x.webSocketDebuggerUrl && x.url === TARGET);
if (!t) { console.log("NO-TARGET"); process.exit(1); }
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
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return { EXC: JSON.stringify(r.exceptionDetails).slice(0, 300) };
  return r && r.result ? r.result.value : r;
}
async function wallpaper() {
  return ev(`(() => { var v = document.getElementById("__zcode_bg_video"); return v ? { rs: v.readyState, ct: +v.currentTime.toFixed(3), paused: v.paused, vw: v.videoWidth, err: v.error ? v.error.code : null } : "no-el"; })()`);
}

await send("Runtime.enable");
await send("Page.enable");
console.log("wallpaper BEFORE:", JSON.stringify(await wallpaper()));
try {
  const off = await send("Page.setBypassCSP", { enabled: false });
  console.log("bypass OFF:", JSON.stringify(off));
  for (const k of ["http", "blob", "data"]) console.log("under bypass-OFF", JSON.stringify(await ev(mkTest(k))));
  console.log("wallpaper DURING(bypass off):", JSON.stringify(await wallpaper()));
} finally {
  const on = await send("Page.setBypassCSP", { enabled: true });
  console.log("bypass restored:", JSON.stringify(on));
}
await new Promise((r) => setTimeout(r, 1500));
console.log("wallpaper AFTER (bypass on):", JSON.stringify(await wallpaper()));
console.log("under bypass-ON", JSON.stringify(await ev(mkTest("http"))));
ws.close();
process.exit(0);
