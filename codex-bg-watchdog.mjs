// codex-bg watchdog — 常驻看门狗：任何方式打开的 Codex（原生图标/开始菜单）都自动挂壁纸。
//   - Codex 裸跑（命令行里没有 --remote-debugging-port=9224）→ 立刻交给
//     ensure-codex-debug.ps1 带端口重启（聊天记录保留）
//   - 带端口启动中的实例（端口冷启动要 10~15 秒才开）→ 只等，绝不杀
//   - 端口开着但一个 CDP page target 都没有（Codex 卡在 "ChatGPT failed to start."
//     对话框上，ERR_FAILED / data: 页没提交）→ 同样是坏实例，杀掉带端口重启
//   - 端口开着但注入器死了 → 自动补拉
//   - config.json "enabled": false 时全停（面板里关壁纸即停看门狗动作）
// 单实例：.watchdog.lock 触碰文件（15 秒内被摸过 = 别的实例活着）。日志 → launcher.log。
// 开机自启：shell:startup 里放指向本脚本的快捷方式。
//
// 2026-10-12 修复：旧版「appAlive && !portOk → 等 10 秒 → 杀 + 1.5 秒后激活」有两个坑：
//   ① 冷启动开端口要 10~15 秒，10 秒宽限会把正常启动中的实例杀掉；
//   ② taskkill 后只等 1.5 秒就 COM 激活，此时旧实例还没退干净，激活参数被丢掉
//      （COM 激活对已运行实例会静默丢弃参数，且会让 app 自己在 20 秒内退出），
//      然后盲等 90 秒才放弃 —— 用户白看约 2 分钟没壁纸的 Codex。
// 现在判定裸跑只看命令行标志，修复走 ensure-codex-debug.ps1（等进程真退干净 + 丢参数立刻重试）。
//
// 2026-10-17 修复②：修好的实例偶尔会「带着端口但页面一个都没起来」——只剩一个
//   Win32 对话框 ChatGPT failed to start.（class #32770），Chrome_WidgetWin_0 隐藏，
//   CDP /json/list 恒为 []。旧版只看端口，于是认为它健康，注入器和看门狗双双空转，
//   用户点了任务栏图标「没反应、没壁纸」。现在用 codex-bg-stuck.mjs 的判据
//   （启动失败对话框 8 秒 / 无 page target 90 秒且有可见窗口 / 硬上限 150 秒）识别并重启，
//   60 秒冷却防止刚修好的实例被上一实例的残余对话框重复杀。
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyStuck, STUCK_DIALOG_MIN_SEC, STUCK_LIST_FAIL_SEC } from "./codex-bg-stuck.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.join(here, ".watchdog.lock");
const ensureScript = path.join(here, "ensure-codex-debug.ps1");
const winStateScript = path.join(here, "codex-bg-winstate.ps1");
const DEBUG_PORT = 9224;

const log = (s) => {
  try {
    fs.appendFileSync(path.join(here, "launcher.log"), `${new Date().toLocaleString()} [watchdog] ${s}\n`);
  } catch {}
};

let lastTouch = 0;
try {
  lastTouch = fs.statSync(lockPath).mtimeMs;
} catch {}
if (Date.now() - lastTouch < 15000) {
  process.exit(0);
}
const touch = () => {
  try {
    fs.writeFileSync(lockPath, new Date().toLocaleString());
  } catch {}
};
touch();
log("watchdog started");

const tasklistHas = (filter, image) =>
  new Promise((resolve) => {
    execFile("tasklist", ["/FI", filter, "/FO", "CSV"], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(String(stdout).toLowerCase().includes(image.toLowerCase()));
    });
  });
const appRunning = () => tasklistHas("IMAGENAME eq ChatGPT.exe", "chatgpt.exe");

// Codex 26.1106+ 的调试端口只绑 [::1]（IPv6 回环），旧版绑 127.0.0.1 —— 两个都试，
// 记住能用的那个；缓存失灵就重新探测（与 codex-statusbar.mjs 同一套做法）。
const CDP_HOSTS = ["127.0.0.1", "localhost"];
let cdpHost = null;
const cdpGet = async (p, timeoutMs) => {
  const hosts = cdpHost ? [cdpHost, ...CDP_HOSTS.filter((h) => h !== cdpHost)] : CDP_HOSTS;
  let lastErr;
  for (const host of hosts) {
    try {
      const r = await fetch(`http://${host}:${DEBUG_PORT}${p}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) {
        lastErr = new Error("HTTP " + r.status);
        continue;
      }
      cdpHost = host;
      return r;
    } catch (e) {
      if (cdpHost === host) cdpHost = null; // 缓存的主机失灵，下次重新探测
      lastErr = e;
    }
  }
  throw lastErr;
};

const checkPort = async () => {
  try {
    const r = await cdpGet("/json/version", 2000);
    return r.ok;
  } catch {
    return false;
  }
};

// 端口活着不代表实例健康：卡死的实例端口是开的，但 /json/list 恒为 []。
// 返回 page 型 target 数量；端口没开或请求失败返回 null（= 不是「卡死」这种坏法）。
const cdpPageTargets = async () => {
  try {
    const r = await cdpGet("/json/list", 2500);
    if (!r.ok) return null;
    const list = await r.json();
    return Array.isArray(list) ? list.filter((t) => t.type === "page").length : null;
  } catch {
    return null;
  }
};

// 只在「怀疑卡死」时才调用（Add-Type 约 1 秒），正常路径零开销。
const winState = () =>
  new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", winStateScript],
      { windowsHide: true, timeout: 20000 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const line = String(stdout).trim().split(/\r?\n/).pop();
          resolve(JSON.parse(line));
        } catch {
          resolve(null);
        }
      },
    );
  });

const injectorRunning = async () => {
  let pid = "";
  try {
    pid = fs.readFileSync(path.join(here, ".injector.lock"), "utf8").trim();
  } catch {
    return false;
  }
  if (!/^\d+$/.test(pid)) return false;
  return tasklistHas(`PID eq ${pid}`, "node.exe");
};

const spawnInjectorViaCmd = () => {
  log("watchdog spawning injector");
  try {
    // 直接 spawn node 并把 stdout/stderr 接到 injector.log：windowsHide=CREATE_NO_WINDOW，
    // 任何终端（含 Win11 默认终端 Windows Terminal）都不会弹窗口。
    const out = fs.openSync(path.join(here, "injector.log"), "a");
    const child = spawn(process.execPath, ["codex-bg.mjs", "--attach"], {
      cwd: here,
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
    });
    child.unref();
  } catch (e) {
    log("spawn injector err: " + String(e).slice(0, 120));
  }
};

// 裸跑判定：命令行里有没有 --remote-debugging-port。命令行是进程创建时就定下的，
// 所以带端口启动的实例从第一刻就带标志；端口本身要 10~15 秒后才开，光看端口分不出
// 「正在启动」和「裸跑」—— 这就是旧版误杀的原因。
const portedAppPresent = () =>
  new Promise((resolve) => {
    const ps =
      'try { $p = Get-CimInstance Win32_Process -Filter "Name=\'ChatGPT.exe\'" -ErrorAction SilentlyContinue | ' +
      "Where-Object { $_.CommandLine -like '*--remote-debugging-port=" + DEBUG_PORT + "*' }; " +
      "if ($p) { 'yes' } else { 'no' } } catch { 'no' }";
    execFile("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      resolve(!err && String(stdout).trim() === "yes");
    });
  });

// 自验修复：杀裸跑实例 → 等进程真退干净 → 带端口激活 → 丢参数立刻重试。
// 绝不在实例还活着时激活（那正是丢参数、并让 app 自己退出的原因）。
// force=true 用于「端口开着但一个 page target 都没有」的卡死实例：
// 那种实例端口是好的，ensure-codex-debug 默认会直接退出说 nothing to do，
// 必须用 -Force 跳过那个早退和「带端口实例正在启动就别动它」的保护。
const ensurePorted = (force = false) =>
  new Promise((resolve) => {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ensureScript, "-Port", String(DEBUG_PORT)];
    if (force) args.push("-Force");
    execFile(
      "powershell",
      args,
      { windowsHide: true, timeout: 180000 },
      (err, stdout) => {
        const tail = String(stdout || "").trim().split(/\r?\n/).slice(-3).join(" | ");
        log("watchdog ensure-codex-debug " + (err ? "FAIL: " : "exit=0: ") + tail.slice(0, 300));
        resolve(!err);
      },
    );
  });

const enabled = () => {
  try {
    return !/"enabled"\s*:\s*false/i.test(fs.readFileSync(path.join(here, "config.json"), "utf8"));
  } catch {
    return true;
  }
};

// 统一的修复动作：杀坏实例 → 带端口重启（聊天记录保留）→ 补拉注入器。
// 循环保护：5 分钟内修 3 次说明「重启也救不回来」，就停手 10 分钟并大声记日志，
// 免得把用户的 Codex 反复杀掉。
let lastRepairAt = 0;
let lastWin = null;
const repairTimes = [];
let backoffUntil = 0;
let backoffLogged = false;
let lastStatusLog = 0;
let repairing = false;
const repairInstance = async (why, { force = false } = {}) => {
  lastRepairAt = Date.now();
  lastWin = null;
  repairTimes.push(Date.now());
  while (repairTimes.length && Date.now() - repairTimes[0] > 300000) repairTimes.shift();
  log(`${why} - repairing${force ? " (forced restart)" : ""}`);
  repairing = true;
  try {
    if (await ensurePorted(force)) {
      log("watchdog reactivated Codex with port");
      await delay(2000);
      if (!(await injectorRunning())) spawnInjectorViaCmd();
      if (repairTimes.length >= 3) {
        backoffUntil = Date.now() + 600000;
        backoffLogged = false;
        log(
          `watchdog: Codex needed ${repairTimes.length} repairs within 5 minutes - backing off for 10 minutes ` +
            "(it looks like a restart does not bring it back; leaving it alone instead of killing it again)",
        );
      }
      return true;
    }
    log("FAIL: ensure-codex-debug could not bring up port " + DEBUG_PORT);
    return false;
  } finally {
    repairing = false;
  }
};

let appAlive, portOk;
let zeroTargetsSince = 0;
let lastWinCheck = 0;
// 主循环心跳：主循环要是卡在某个 await 上（真机上注入器出过这种事，日志里一点痕迹都没有），
// 看门狗会安静地什么都不做。这里只做「让它可见」：修的时候不算卡（ensure 可能跑 3 分钟）。
let lastLoopBeat = Date.now();
setInterval(() => {
  const stalled = Date.now() - lastLoopBeat;
  if (!repairing && stalled > 90000) {
    log("watchdog main loop has not completed a round for " + Math.round(stalled / 1000) + "s - it looks stuck");
  }
}, 20000);
while (true) {
  try {
    if (enabled()) {
      appAlive = await appRunning();
      portOk = await checkPort();
      if (appAlive && !portOk) {
        zeroTargetsSince = 0;
        lastWin = null;
        if (await portedAppPresent()) {
          // 带端口启动中：端口还没开而已，别动它
          await delay(3000);
        } else {
          await repairInstance("bare Codex detected (no --remote-debugging-port=" + DEBUG_PORT + ")");
        }
      } else if (portOk) {
        const targets = await cdpPageTargets();
        // targets === null 且端口是开的 = /json/list 请求失败或挂住（实测这种坏法也存在）。
        // 旧逻辑把它和「端口没开」混在一起当成正常，于是永远不修 —— 现在单独计数并修复。
        const listUnusable = targets === null;
        const bad = listUnusable || targets === 0;
        if (!bad) {
          zeroTargetsSince = 0;
          lastWin = null;
        } else {
          if (!zeroTargetsSince) zeroTargetsSince = Date.now();
          const zeroTargetsSec = (Date.now() - zeroTargetsSince) / 1000;
          if (!listUnusable && zeroTargetsSec >= STUCK_DIALOG_MIN_SEC && Date.now() - lastWinCheck > 5000) {
            lastWin = await winState();
            lastWinCheck = Date.now();
          }
          const verdict = listUnusable
            ? zeroTargetsSec >= STUCK_LIST_FAIL_SEC
              ? { action: "repair", reason: "list-unusable" }
              : { action: "wait", reason: "too-early" }
            : classifyStuck({
                pageTargets: targets,
                zeroTargetsSec,
                dialog: !!(lastWin && lastWin.dialog),
                visibleWindows: lastWin && Number.isFinite(lastWin.visible) ? lastWin.visible : 0,
                sinceRepairMs: lastRepairAt ? Date.now() - lastRepairAt : Infinity,
              });
          if (Date.now() - lastStatusLog > 60000) {
            lastStatusLog = Date.now();
            log(
              `watchdog status: port ${DEBUG_PORT} is up but the app looks unhealthy for ` +
                `${Math.round(zeroTargetsSec)}s (${listUnusable ? "no usable /json/list" : "page targets=" + targets}` +
                `${lastWin ? `, dialog=${!!lastWin.dialog}, visible=${lastWin.visible}` : ""}) -> ${verdict.action}/${verdict.reason}`,
            );
          }
          if (verdict.action === "repair") {
            if (Date.now() < backoffUntil) {
              if (!backoffLogged) {
                backoffLogged = true;
                log(
                  "watchdog: Codex is still stuck but we are in backoff until " +
                    new Date(backoffUntil).toLocaleString() +
                    " - leaving it alone (ports/targets unchanged)",
                );
              }
            } else {
              backoffLogged = false;
              zeroTargetsSince = 0;
              await repairInstance(
                `port ${DEBUG_PORT} is up but Codex has no CDP page target for ` +
                  `${Math.round(zeroTargetsSec)}s (${verdict.reason}` +
                  `${lastWin ? `, dialog=${!!lastWin.dialog}, visible=${lastWin.visible}` : ""})`,
                { force: true },
              );
            }
          }
        }
        // 卡死状态下不补拉注入器：它会一直停在「等待主窗口…」白烧进程，
        // 等修好了再拉（修好后 zeroTargetsSince 归零，下一次循环就会补拉）。
        if (!bad && !(await injectorRunning())) {
          log("injector dead - respawning");
          spawnInjectorViaCmd();
        }
      }
    }
  } catch (e) {
    log("loop err: " + String(e).slice(0, 120));
  }
  touch();
  lastLoopBeat = Date.now();
  await delay(2500);
}
