// 顶层 box 布局 + 各 trak 的 stco/样本表诊断，验证「chunk 偏移是否可信」
import fs from "node:fs";

const f = process.argv[2];
const buf = fs.readFileSync(f);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const dv = new DataView(ab);

function fourCC(p) { return String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3)); }
function walk(start, end, cb) {
  let off = start;
  while (off + 8 <= end) {
    let size = dv.getUint32(off) >>> 0, hdr = 8;
    if (size === 1) { size = dv.getUint32(off + 8) * 4294967296 + (dv.getUint32(off + 12) >>> 0); hdr = 16; }
    else if (size === 0) size = end - off;
    if (size < hdr || off + size > end) { console.log(`  !! bad box at ${off}: type=${fourCC(off + 4)} size=${size}`); break; }
    cb(fourCC(off + 4), off, off + hdr, off + size);
    off += size;
  }
}
console.log("=== top-level ===");
walk(0, ab.byteLength, (t, b, s, e) => console.log(`  ${t} @${b} size=${e - b} payload=${s}..${e}`));

console.log("=== traks ===");
walk(0, ab.byteLength, (t, b, s, e) => {
  if (t !== "moov") return;
  let n = 0;
  walk(s, e, (t2, b2, s2, e2) => {
    if (t2 !== "trak") return;
    const tag = `trak#${n++}`;
    let handler = "?", timescale = 0;
    walk(s2, e2, (t3, b3, s3, e3) => {
      if (t3 !== "mdia") return;
      walk(s3, e3, (t4, b4, s4, e4) => {
        if (t4 === "hdlr") handler = fourCC(s4 + 8);
        if (t4 === "mdhd") { const v = dv.getUint8(s4); timescale = v === 0 ? dv.getUint32(s4 + 12) : dv.getUint32(s4 + 20); }
        if (t4 === "minf") walk(s4, e4, (t5, b5, s5, e5) => {
          if (t5 !== "stbl") return;
          walk(s5, e5, (t6, b6, s6, e6) => {
            if (t6 === "stco" || t6 === "co64") {
              const cnt = dv.getUint32(s6 + 4) >>> 0;
              const arr = [];
              for (let i = 0; i < Math.min(cnt, 12); i++) arr.push(t6 === "stco" ? dv.getUint32(s6 + 8 + i * 4) : dv.getUint32(s6 + 8 + i * 8) * 4294967296 + dv.getUint32(s6 + 12 + i * 8));
              console.log(`  ${tag} handler=${handler} ${t6} count=${cnt} first=${JSON.stringify(arr)}`);
            }
            if (t6 === "stsc") {
              const cnt = dv.getUint32(s6 + 4) >>> 0;
              const arr = [];
              for (let i = 0; i < Math.min(cnt, 12); i++) arr.push([dv.getUint32(s6 + 8 + i * 12), dv.getUint32(s6 + 12 + i * 12), dv.getUint32(s6 + 16 + i * 12)]);
              console.log(`  ${tag} handler=${handler} stsc count=${cnt} [first,perSample,descIdx]=${JSON.stringify(arr)}`);
            }
            if (t6 === "stsz") {
              const szDef = dv.getUint32(s6 + 4) >>> 0, cnt = dv.getUint32(s6 + 8) >>> 0;
              console.log(`  ${tag} handler=${handler} stsz def=${szDef} count=${cnt} first=${JSON.stringify(Array.from({ length: Math.min(cnt, 10) }, (_, i) => dv.getUint32(s6 + 12 + i * 4)))}`);
            }
            if (t6 === "stss") {
              const cnt = dv.getUint32(s6 + 4) >>> 0;
              const arr = [];
              for (let i = 0; i < Math.min(cnt, 12); i++) arr.push(dv.getUint32(s6 + 8 + i * 4));
              console.log(`  ${tag} handler=${handler} stss count=${cnt} first=${JSON.stringify(arr)}`);
            }
            if (t6 === "ctts") {
              const cnt = dv.getUint32(s6 + 4) >>> 0;
              const arr = [];
              for (let i = 0; i < Math.min(cnt, 6); i++) arr.push([dv.getUint32(s6 + 8 + i * 8), dv.getInt32(s6 + 12 + i * 8)]);
              console.log(`  ${tag} handler=${handler} ctts ver=${dv.getUint8(s6)} count=${cnt} [cnt,off]=${JSON.stringify(arr)}`);
            }
            if (t6 === "stts") {
              const cnt = dv.getUint32(s6 + 4) >>> 0;
              const arr = [];
              for (let i = 0; i < Math.min(cnt, 6); i++) arr.push([dv.getUint32(s6 + 8 + i * 8), dv.getUint32(s6 + 12 + i * 8)]);
              console.log(`  ${tag} handler=${handler} stts count=${cnt} [cnt,delta]=${JSON.stringify(arr)}`);
            }
          });
        });
      });
    });
    console.log(`  ${tag} handler=${handler} timescale=${timescale}`);
  });
});

// 连续排布假设：从第一个样本偏移开始按 size 顺次排，验证 AVCC 结构是否成立
console.log("=== 连续假设校验（video trak）===");
const src = fs.readFileSync("wc-player.js", "utf8");
globalThis.window = globalThis;
new Function(src)();
const mp4 = globalThis.window.__zcodeBgVideoWc.testParse(ab);
let p = mp4.samples[0].off, good = 0, badAt = -1;
for (let i = 0; i < mp4.samples.length; i++) {
  const sz = mp4.samples[i].size;
  let q = p, ok = true, guard = 0;
  while (q + 4 <= p + sz && guard++ < 200) { const l = dv.getUint32(q); if (l <= 0 || q + 4 + l > p + sz) { ok = false; break; } q += 4 + l; }
  if (q !== p + sz) ok = false;
  if (!ok) { badAt = i; break; }
  good++; p += sz;
}
console.log(`连续假设：前 ${good} 个样本合法，首个不合法 idx=${badAt}，连续排布总长=${p} 文件长=${ab.byteLength}`);
