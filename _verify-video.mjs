// 修复验证：reload 让 setBypassCSP 生效 → 库能读 → 点视频卡片 → WC 播放
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
    delay(15000).then(() => { throw new Error(method + ": timeout"); }),
  ]);
}
async function evalJs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error("page-exc: " + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r && r.result ? r.result.value : undefined;
}
await send("Page.enable");
await send("Runtime.enable");

console.log("checking ui…");

// 注入器 2 秒轮询会自动重附重注入
for (let i = 0; i < 15; i++) {
  const ok = await evalJs(`window.__zcodeBgUi ? "ui-v" + window.__zcodeBgUi.version : "waiting"`);
  if (String(ok).startsWith("ui-")) { console.log("ui:", ok); break; }
  await delay(1500);
}
await evalJs(`window.__zcodeBgUi.open()`);
await delay(5000);

const info = await evalJs(`(function(){
  var items = document.querySelectorAll("button.zcbg-lib-item");
  var hints = [];
  document.querySelectorAll(".zcbg-hint").forEach(function(h){ var s = String(h.textContent); if (s.indexOf("失败") >= 0 || s.indexOf("正在") >= 0) hints.push(s.slice(0, 60)); });
  return { itemCount: items.length, hints: hints };
})()`);
console.log("info:", JSON.stringify(info));

const clicked = await evalJs(`(function(){
  var hit = null;
  document.querySelectorAll("button.zcbg-lib-item").forEach(function(b){
    if (!hit && (b.title || "").indexOf("夜刀神十香（视频）") === 0) hit = b;
  });
  if (!hit) return "NO-CARD";
  hit.click();
  return "CLICKED";
})()`);
console.log("click:", clicked);
await delay(15000);

const st = await evalJs(`(function(){
  var wc = window.__zcodeBgVideoWc;
  var c = document.getElementById("__zcode_bg_video_wc");
  var v = document.getElementById("__zcode_bg_video");
  return {
    wcActive: wc ? wc.active() : null,
    wcPainted: wc ? wc.painted() : null,
    canvas: !!c,
    canvasOpacity: c ? c.style.opacity : null,
    videoRs: v ? v.readyState : null,
    fbImg: !!document.getElementById("__zcode_bg_video_fb")
  };
})()`);
console.log("state:", JSON.stringify(st));

if (st && st.canvas) {
  const p1 = await evalJs(`(function(){
    var c = document.getElementById("__zcode_bg_video_wc");
    var ctx = c.getContext("2d");
    var d = ctx.getImageData(Math.floor(c.width/4), Math.floor(c.height/4), 64, 64).data;
    var s = 0;
    for (var i = 0; i < d.length; i += 16) { s += d[i] + d[i+1] + d[i+2]; }
    return { sum: s, w: c.width, h: c.height };
  })()`);
  await delay(1200);
  const p2 = await evalJs(`(function(){
    var c = document.getElementById("__zcode_bg_video_wc");
    var ctx = c.getContext("2d");
    var d = ctx.getImageData(Math.floor(c.width/4), Math.floor(c.height/4), 64, 64).data;
    var s = 0;
    for (var i = 0; i < d.length; i += 16) { s += d[i] + d[i+1] + d[i+2]; }
    return { sum: s, w: c.width, h: c.height };
  })()`);
  console.log("pixels:", JSON.stringify(p1), JSON.stringify(p2), "changed:", p1 && p2 && p1.sum !== p2.sum);
}

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("verify-we-video.png", Buffer.from(shot.data, "base64"));
console.log("screenshot saved: verify-we-video.png");
ws.close();
process.exit(0);
