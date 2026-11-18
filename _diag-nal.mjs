// Node 侧检查分包器输出：样本 offset/size 是否指向合法 AVCC 数据（每个样本 = 若干 [4字节长度][NAL]）
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "wc-player.js"), "utf8");
globalThis.window = globalThis;
new Function(src)();
const WC = globalThis.window.__zcodeBgVideoWc;

const files = process.argv.slice(2);
for (const f of files) {
  const buf = fs.readFileSync(f);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let mp4;
  try {
    mp4 = WC.testParse(ab);
  } catch (e) {
    console.log(`${path.basename(f)}  PARSE-FAIL ${e.message}`);
    continue;
  }
  const dv = new DataView(ab);
  const bad = [];
  const info = [];
  for (let i = 0; i < mp4.samples.length; i++) {
    const s = mp4.samples[i];
    let p = s.off, nals = 0, sum = 4, ok = true, shapes = [];
    while (p + 4 <= s.off + s.size) {
      const len = dv.getUint32(p);
      if (len <= 0 || p + 4 + len > s.off + s.size) { ok = false; break; }
      shapes.push(len);
      sum += len;
      nals++;
      p += 4 + len;
      if (nals > 64) { ok = false; break; }
    }
    if (p !== s.off + s.size) ok = false;
    if (!ok) bad.push({ i, off: s.off, size: s.size, nals, shapes: shapes.slice(0, 4) });
    if (i < 12) info.push(`#${i} off=${s.off} size=${s.size} pts=${s.pts} dur=${s.dur} key=${s.key} nals=${nals} lens=[${shapes.slice(0, 3)}]`);
  }
  console.log(`\n=== ${path.basename(f)} === codec=${mp4.codec} samples=${mp4.samples.length} timescale=${mp4.timescale} durUs=${mp4.durUs} descLen=${mp4.desc.length} fileLen=${ab.byteLength}`);
  console.log(info.join("\n"));
  const keys = mp4.samples.map((s, i) => (s.key ? i : -1)).filter((x) => x >= 0);
  console.log(`keyframes(${keys.length}): ${keys.slice(0, 10)}`);
  console.log(`pts monotonic: ${mp4.samples.every((s, i) => i === 0 || s.pts >= mp4.samples[i - 1].pts)}`);
  console.log(`badSamples(${bad.length}): ${JSON.stringify(bad.slice(0, 6))}`);
  const last = mp4.samples[mp4.samples.length - 1];
  console.log(`lastSampleEnd=${last.off + last.size} (file=${ab.byteLength})`);
}
