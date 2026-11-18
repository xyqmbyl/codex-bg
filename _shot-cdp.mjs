// _shot-cdp.mjs - screenshot the injected Codex page through CDP (no window chrome).
// Usage: node _shot-cdp.mjs [out.png]
// Reads the page target from /json/list, connects to its webSocketDebuggerUrl and calls
// Page.captureScreenshot. Read-only: it never reloads or mutates the page.
import fs from "node:fs";

const PORT = 9224;
const out = process.argv[2] || "codex-page.png";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2500) })).json();
const page = list.find((t) => t.url === "app://-/index.html");
if (!page) {
  console.error("no page target with url app://-/index.html; got: " + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
console.log("target: " + page.url + "  title=" + page.title);

// Node's built-in global WebSocket (no npm dependencies in this project).
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.addEventListener("message", (ev) => {
  const text = typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8");
  const msg = JSON.parse(text);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

// What the injector actually put on the page, and whether the wallpaper pixels are real.
const probe = await send("Runtime.evaluate", {
  expression: `(() => {
    const cs = getComputedStyle(document.documentElement);
    const bs = getComputedStyle(document.body);
    const img = window.__zcode_bg_image || null;
    const vid = document.getElementById("__zcode_bg_video");
    return JSON.stringify({
      htmlBgImage: (cs.backgroundImage || "").slice(0, 90),
      htmlBgColor: cs.backgroundColor,
      bodyBg: bs.backgroundColor,
      hasImageVar: !!img,
      imageNaturalW: img ? img.naturalWidth : 0,
      hasVideo: !!vid,
      videoReadyState: vid ? vid.readyState : -1,
      videoW: vid ? vid.videoWidth : 0,
      panel: !!document.querySelector("[data-zcode-bg-panel]"),
      version: window.__zcode_bg_ui_version || null,
      title: document.title,
    });
  })()`,
  returnByValue: true,
});
console.log("probe: " + probe.result.value);

const shot = await send("Page.captureScreenshot", { format: "png" }, 30000);
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("saved: " + out + " (" + fs.statSync(out).size + " bytes)");
ws.close();
process.exit(0);
