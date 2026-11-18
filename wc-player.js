/* codex-bg WebCodecs 视频壁纸播放器（页面侧源码）。
 *
 * 背景：Codex 桌面壳不带 ffmpeg.dll，<video>/<audio> 全都起不来（readyState 永远 0，
 * 连 data:URL 的 WAV 都解不了）。WebCodecs 的 VideoDecoder 走系统解码器（Media
 * Foundation），不依赖 ffmpeg——这里自写最小 MP4（非分片）解包器 + 解码队列 +
 * canvas 循环渲染，把视频真的播起来。解码失败时回调 __zcodeBgVideoWcOnFail。
 */
(function () {
  if (typeof window === "undefined") return;
  if (window.__zcodeBgVideoWc && window.__zcodeBgVideoWc.__v === 3) return;

  var R = null;

  function hex2(n) {
    var s = (n & 255).toString(16);
    return s.length < 2 ? "0" + s : s;
  }

  window.__zcodeBgVideoWc = {
    __v: 3,
    active: function () {
      return !!R;
    },
    painted: function () {
      return !!(R && R.painted);
    },
    start: function (vs) {
      try {
        start(vs);
      } catch (e) {
        try {
          window.__zcodeBgVideoWcLastErr = String((e && e.stack) || e);
        } catch (e2) {}
        fail();
      }
    },
    stop: function () {
      cleanup();
    },
    /* 调试口：Node 单测和页面探针都能直接调分包器 */
    testParse: function (buf) {
      return parseMp4(buf);
    },
  };

  function fail() {
    cleanup();
    try {
      if (typeof window.__zcodeBgVideoWcOnFail === "function") window.__zcodeBgVideoWcOnFail();
    } catch (e) {}
  }

  function cleanup() {
    var r = R;
    R = null;
    window.__zcodeBgVideoWcActive = false;
    if (!r) return;
    if (r.pump) clearInterval(r.pump);
    if (r.raf) {
      try {
        cancelAnimationFrame(r.raf);
      } catch (e) {}
    }
    if (r.dec) {
      try {
        r.dec.close();
      } catch (e) {}
    }
    if (r.onResize) {
      try {
        window.removeEventListener("resize", r.onResize);
      } catch (e) {}
    }
    if (r.onVis) {
      try {
        document.removeEventListener("visibilitychange", r.onVis);
      } catch (e) {}
    }
    if (r.queue) {
      for (var i = 0; i < r.queue.length; i++) {
        try {
          r.queue[i].close();
        } catch (e) {}
      }
    }
    if (r.canvas && r.canvas.parentElement) {
      try {
        r.canvas.remove();
      } catch (e) {}
    }
  }

  /* ---------------- 最小 MP4（非分片）解包：视频轨 → 样本表 ---------------- */
  /* 返回 { samples:[{off,size,pts,dur,key}], timescale, durUs, codec, desc } */
  function parseMp4(buf) {
    var dv = new DataView(buf);
    function fourCC(p) {
      return String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    }
    function walk(start, end, cb) {
      var off = start;
      while (off + 8 <= end) {
        var size = dv.getUint32(off) >>> 0;
        var hdr = 8;
        if (size === 1) {
          size = dv.getUint32(off + 8) * 4294967296 + (dv.getUint32(off + 12) >>> 0);
          hdr = 16;
        } else if (size === 0) {
          size = end - off;
        }
        if (size < hdr || off + size > end) break;
        if (cb(fourCC(off + 4), off + hdr, off + size) === true) return;
        off += size;
      }
    }
    function findOne(start, end, want) {
      var hit = null;
      walk(start, end, function (t, s, e) {
        if (t === want) {
          hit = [s, e];
          return true;
        }
        return false;
      });
      return hit;
    }

    var moov = findOne(0, buf.byteLength, "moov");
    if (!moov) throw new Error("no moov");
    var result = null;
    var lastErr = "";
    walk(moov[0], moov[1], function (t, s, e) {
      if (t !== "trak") return false;
      try {
        var tk = parseTrak(s, e);
        if (tk) {
          result = tk;
          return true;
        }
      } catch (e2) {
        lastErr = String((e2 && e2.message) || e2);
      }
      return false;
    });
    if (!result) throw new Error("no video trak" + (lastErr ? "（" + lastErr + "）" : ""));
    return result;

    function parseTrak(ts, te) {
      var mdia = findOne(ts, te, "mdia");
      if (!mdia) return null;
      var hdlr = findOne(mdia[0], mdia[1], "hdlr");
      if (!hdlr || hdlr[1] - hdlr[0] < 12) return null;
      var handler = fourCC(hdlr[0] + 8);
      if (handler !== "vide") return null;
      var mdhd = findOne(mdia[0], mdia[1], "mdhd");
      if (!mdhd) return null;
      var ver = dv.getUint8(mdhd[0]);
      var timescale = ((ver === 0 ? dv.getUint32(mdhd[0] + 12) : dv.getUint32(mdhd[0] + 20)) >>> 0) || 1000;
      var minf = findOne(mdia[0], mdia[1], "minf");
      if (!minf) return null;
      var stbl = findOne(minf[0], minf[1], "stbl");
      if (!stbl) throw new Error("no stbl");

      /* stsd：找 avc1/hvc1 条目，抄 avcC/hvcC 当 description */
      var stsd = findOne(stbl[0], stbl[1], "stsd");
      if (!stsd) throw new Error("no stsd");
      var entryCount = dv.getUint32(stsd[0] + 4) >>> 0;
      var p = stsd[0] + 8;
      var codec = "",
        desc = null;
      for (var i = 0; i < entryCount && p + 8 <= stsd[1]; i++) {
        var esz = dv.getUint32(p) >>> 0;
        if (esz < 8) break;
        var fmt = fourCC(p + 4);
        if (fmt === "avc1" || fmt === "avc3" || fmt === "hvc1" || fmt === "hev1") {
          // VisualSampleEntry 头 78 字节，后面才是子 box（8+78=86）
          var child = findOne(p + 86, Math.min(p + esz, stsd[1]), fmt.indexOf("avc") === 0 ? "avcC" : "hvcC");
          if (child) {
            desc = new Uint8Array(buf, child[0], child[1] - child[0]);
            codec = fmt.indexOf("avc") === 0 ? "avc1." + hex2(desc[1]) + hex2(desc[2]) + hex2(desc[3]) : "hvc1.1.6.L93.B0";
          }
          break;
        }
        p += esz;
      }
      if (!codec) throw new Error("no avc1/hvc1 entry");
      if (!desc || desc.length < 8) throw new Error("no avcC/hvcC");

      /* stts → 每样本时长与 DTS（解码序，timescale 单位） */
      var stts = findOne(stbl[0], stbl[1], "stts");
      if (!stts) throw new Error("no stts");
      var durs = [];
      var dtsArr = [];
      var tsAcc = 0;
      var nT = dv.getUint32(stts[0] + 4) >>> 0;
      p = stts[0] + 8;
      for (i = 0; i < nT; i++) {
        var cCnt = dv.getUint32(p) >>> 0;
        var cDelta = dv.getUint32(p + 4) >>> 0;
        for (var k = 0; k < cCnt && durs.length < 4000000; k++) {
          durs.push(cDelta);
          dtsArr.push(tsAcc);
          tsAcc += cDelta;
        }
        p += 8;
      }
      var nSamples = durs.length;

      /* stss → 关键帧（1 基样本号）；没有的默认全是关键帧 */
      var keySet = null;
      var stssBox = findOne(stbl[0], stbl[1], "stss");
      if (stssBox) {
        keySet = {};
        var nS = dv.getUint32(stssBox[0] + 4) >>> 0;
        for (i = 0; i < nS; i++) keySet[dv.getUint32(stssBox[0] + 8 + i * 4) >>> 0] = 1;
      }

      /* ctts → 合成偏移（B 帧），v1 是有符号的 */
      var ctoArr = null;
      var cttsBox = findOne(stbl[0], stbl[1], "ctts");
      if (cttsBox) {
        var verC = dv.getUint8(cttsBox[0]);
        var nC = dv.getUint32(cttsBox[0] + 4) >>> 0;
        ctoArr = new Array(nSamples);
        var q = cttsBox[0] + 8;
        var si = 0;
        for (i = 0; i < nC && si < nSamples; i++) {
          var c2 = dv.getUint32(q) >>> 0;
          var offC = verC === 1 ? dv.getInt32(q + 4) : (dv.getUint32(q + 4) >>> 0);
          for (var k = 0; k < c2 && si < nSamples; k++) ctoArr[si++] = offC;
          q += 8;
        }
      }

      /* stsz → 每样本大小 */
      var stszBox = findOne(stbl[0], stbl[1], "stsz");
      if (!stszBox) throw new Error("no stsz");
      var szDef = dv.getUint32(stszBox[0] + 4) >>> 0;
      var nZ = dv.getUint32(stszBox[0] + 8) >>> 0;
      var sizes = new Array(nSamples);
      if (szDef) {
        for (i = 0; i < nSamples; i++) sizes[i] = szDef;
      } else {
        for (i = 0; i < nZ && i < nSamples; i++) sizes[i] = dv.getUint32(stszBox[0] + 12 + i * 4) >>> 0;
      }

      /* stsc → 每个 chunk 的样本数 */
      var stscBox = findOne(stbl[0], stbl[1], "stsc");
      if (!stscBox) throw new Error("no stsc");
      var scN = dv.getUint32(stscBox[0] + 4) >>> 0;
      /* 注意：stsc 每条记录是 12 字节（first_chunk / samples_per_chunk / sample_description_index），
       * 早期版本按 8 字节步进读，导致第 2 个 chunk 之后的样本偏移全错 → 解码器喂到第 7 个样本必死。 */
      var scFirst = new Array(scN),
        scPer = new Array(scN);
      for (i = 0; i < scN; i++) {
        scFirst[i] = dv.getUint32(stscBox[0] + 8 + i * 12) >>> 0;
        scPer[i] = dv.getUint32(stscBox[0] + 12 + i * 12) >>> 0;
      }

      /* stco / co64 → chunk 文件偏移 */
      var stcoBox = findOne(stbl[0], stbl[1], "stco");
      var co64Box = stcoBox ? null : findOne(stbl[0], stbl[1], "co64");
      if (!stcoBox && !co64Box) throw new Error("no stco");
      var is64 = !stcoBox;
      var coB = (stcoBox || co64Box)[0];
      var coN = dv.getUint32(coB + 4) >>> 0;
      var chunkOff = new Array(coN);
      for (i = 0; i < coN; i++) {
        if (is64) {
          chunkOff[i] = dv.getUint32(coB + 8 + i * 8) * 4294967296 + (dv.getUint32(coB + 12 + i * 8) >>> 0);
        } else {
          chunkOff[i] = dv.getUint32(coB + 8 + i * 4) >>> 0;
        }
      }

      /* 展开 chunk → 样本 */
      var samples = [];
      var si = 0;
      for (var c = 0; c < coN && si < nSamples; c++) {
        var per = 0;
        for (var j = scN - 1; j >= 0; j--) {
          if (scFirst[j] <= c + 1) {
            per = scPer[j];
            break;
          }
        }
        var off = chunkOff[c];
        for (var k2 = 0; k2 < per && si < nSamples; k2++) {
          samples.push({
            off: off,
            size: sizes[si],
            pts: Math.round((dtsArr[si] + (ctoArr ? ctoArr[si] : 0)) * 1000000 / timescale),
            dur: Math.round(durs[si] * 1000000 / timescale),
            key: keySet ? !!keySet[si + 1] : true,
          });
          off += sizes[si];
          si++;
        }
      }
      if (!samples.length) throw new Error("no samples");
      var lastS = samples[samples.length - 1];
      var durUs = lastS.pts + lastS.dur;
      return { samples: samples, timescale: timescale, durUs: durUs, codec: codec, desc: desc };
    }
  }

  /* ---------------- 播放控制 ---------------- */
  function start(vs) {
    if (!vs || !vs.url || typeof VideoDecoder === "undefined") {
      fail();
      return;
    }
    cleanup();
    var my = {
      url: vs.url,
      fit: vs.fit || "cover",
      align: vs.align || "center",
      buf: null,
      samples: null,
      timescale: 1000,
      durMs: 0,
      firstKey: 0,
      feed: 0,
      base: 0,
      hidePos: 0,
      lastDrawn: -1e12,
      queue: [],
      dec: null,
      canvas: null,
      ctx: null,
      pump: 0,
      raf: 0,
      painted: false,
    };
    R = my;
    fetch(vs.url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        if (R !== my) return;
        var mp4 = parseMp4(buf);
        my.buf = buf;
        my.samples = mp4.samples;
        my.timescale = mp4.timescale;
        my.durMs = Math.max(200, mp4.durUs / 1000);
        my.codec = mp4.codec;
        my.desc = mp4.desc;
        launch(my);
      })
      .catch(function (er) {
        if (R === my) {
          try {
            window.__zcodeBgVideoWcLastErr = "fetch: " + String(er);
          } catch (e2) {}
          fail();
        }
      });
  }

  function launch(my) {
    var canvas = document.createElement("canvas");
    canvas.id = "__zcode_bg_video_wc";
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    var st = canvas.style;
    st.position = "fixed";
    st.inset = "0";
    st.width = "100%";
    st.height = "100%";
    st.border = "0";
    st.pointerEvents = "none";
    st.zIndex = "-2";
    st.opacity = "0";
    (document.body || document.documentElement).appendChild(canvas);
    my.canvas = canvas;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(2, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(2, Math.round(window.innerHeight * dpr));
    my.ctx = canvas.getContext("2d");

    my.dec = new VideoDecoder({
      output: function (fr) {
        onOut(my, fr);
      },
      error: function (er) {
        try {
          window.__zcodeBgVideoWcLastErr = "decode: " + String(er);
        } catch (e2) {}
        if (R === my) fail();
      },
    });
    my.dec.configure({ codec: my.codec, description: my.desc });

    var fk = 0;
    while (fk < my.samples.length && !my.samples[fk].key) fk++;
    if (fk >= my.samples.length) fk = 0;
    my.firstKey = fk;
    my.feed = fk;
    my.base = performance.now() - my.samples[fk].pts / 1000;

    my.onResize = function () {
      if (R === my) {
        var d = window.devicePixelRatio || 1;
        canvas.width = Math.max(2, Math.round(window.innerWidth * d));
        canvas.height = Math.max(2, Math.round(window.innerHeight * d));
      }
    };
    my.onVis = function () {
      if (R !== my) return;
      if (document.hidden) {
        my.hidePos = posUs();
        if (my.pump) {
          clearInterval(my.pump);
          my.pump = 0;
        }
        if (my.raf) {
          cancelAnimationFrame(my.raf);
          my.raf = 0;
        }
      } else {
        my.base = performance.now() - (my.hidePos || 0) / 1000;
        if (!my.pump) my.pump = setInterval(pumpTick, 40);
        if (!my.raf) my.raf = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("resize", my.onResize);
    document.addEventListener("visibilitychange", my.onVis);
    my.pump = setInterval(pumpTick, 40);
    my.raf = requestAnimationFrame(tick);
    window.__zcodeBgVideoWcActive = true;
  }

  function posUs() {
    if (!R || !R.durMs) return 0;
    var el = performance.now() - R.base;
    return (el % R.durMs) * 1000;
  }

  function pumpTick() {
    var r = R;
    if (!r || !r.dec) return;
    if (r.dec.state === "closed") {
      fail();
      return;
    }
    var pos = posUs();
    var n = r.samples.length;
    while (r.feed < n && r.dec.decodeQueueSize < 8) {
      var sp = r.samples[r.feed];
      if (sp.pts > pos + 1000000) break;
      try {
        r.dec.decode(
          new EncodedVideoChunk({
            type: sp.key ? "key" : "delta",
            timestamp: sp.pts,
            duration: sp.dur,
            data: new Uint8Array(r.buf, sp.off, sp.size),
          }),
        );
        r.feed++;
      } catch (e) {
        try {
          window.__zcodeBgVideoWcLastErr = "feed: " + String(e);
        } catch (e2) {}
        fail();
        return;
      }
    }
    // 一轮喂完且帧都画完了 → 重建解码器循环重播
    if (r.feed >= n && r.dec.decodeQueueSize === 0 && r.queue.length === 0) {
      try { r.dec.close(); } catch (e) {}
      r.dec = new VideoDecoder({
        output: function (f) {
          onOut(r, f);
        },
        error: function (er) {
          try {
            window.__zcodeBgVideoWcLastErr = "decode2: " + String(er);
          } catch (e2) {}
          if (R === r) fail();
        },
      });
      r.dec.configure({ codec: r.codec, description: r.desc });
      r.feed = r.firstKey;
      r.base = performance.now() - r.samples[r.feed].pts / 1000;
    }
  }

  function onOut(r, fr) {
    if (!R || R !== r) {
      try {
        fr.close();
      } catch (e) {}
      return;
    }
    // 按 PTS 插入（B 帧解码输出会乱序）；队列超长先丢最老的
    var q = r.queue;
    var i = q.length;
    while (i > 0 && q[i - 1].timestamp > fr.timestamp) i--;
    q.splice(i, 0, fr);
    while (q.length > 30) {
      var old = q.shift();
      try {
        old.close();
      } catch (e) {}
    }
  }

  function tick() {
    var r = R;
    if (!r) return;
    r.raf = requestAnimationFrame(tick);
    var pos = posUs();
    var q = r.queue;
    var draw = -1;
    for (var i = 0; i < q.length; i++) {
      if (q[i].timestamp <= pos + 40000) draw = i;
      else break;
    }
    if (draw < 0 && q.length > 2 && performance.now() - r.lastDrawn > 400000) {
      draw = 0; // 解码滞后时硬顶一帧，别黑屏
    }
    if (draw >= 0) {
      var fr = q[draw];
      paintFrame(fr);
      for (var k = 0; k <= draw; k++) {
        try {
          q[k].close();
        } catch (e) {}
      }
      r.queue = q.slice(draw + 1);
      r.lastDrawn = performance.now();
    }
  }

  function paintFrame(fr) {
    var r = R;
    if (!r || !r.ctx) return;
    var cw = r.canvas.width,
      ch = r.canvas.height;
    var vw = fr.displayWidth || fr.codedWidth || 16,
      vh = fr.displayHeight || fr.codedHeight || 16;
    var FITS = { cover: "cover", contain: "contain", fill: "fill", tile: "cover" };
    var mode = FITS[r.fit] || "cover";
    var dx, dy, dw, dh;
    if (mode === "fill") {
      dx = 0;
      dy = 0;
      dw = cw;
      dh = ch;
    } else {
      var s = mode === "contain" ? Math.min(cw / vw, ch / vh) : Math.max(cw / vw, ch / vh);
      dw = Math.round(vw * s);
      dh = Math.round(vh * s);
      dx = Math.round((cw - dw) / 2);
      dy = r.align === "top" ? 0 : r.align === "bottom" ? ch - dh : Math.round((ch - dh) / 2);
    }
    try {
      r.ctx.drawImage(fr, dx, dy, dw, dh);
      r.canvas.style.opacity = "1";
      r.painted = true;
    } catch (e) {}
  }
})();
