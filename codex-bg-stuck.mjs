// codex-bg-stuck.mjs — 「带端口但启动失败」的判定逻辑（纯函数，方便单测）。
//
// 背景：Codex 偶尔会以「带调试端口、但页面一个都没起来」的状态卡死：
//   窗口只剩一个 Win32 对话框 ChatGPT failed to start.（class #32770，
//   正文 ERR_FAILED (-2) loading 'data:text/html...'），Chrome_WidgetWin_0 隐藏，
//   CDP 的 /json/list 一直是 []（Target.getTargets 也是空）。
//   这种实例端口是开着的，所以旧版看门狗「只看端口」会认为它健康；
//   注入器那边 /json/list 请求成功（返回空数组），也不会走「连不上就退出」的分支，
//   于是两边都安静地空转 —— 用户看到的就是「点了任务栏图标没反应、没有壁纸」。
//
// 判据（都在端口已开的前提下）：
//   1) 出现启动失败对话框（#32770）且连续 8 秒没有任何 page target → 卡死，用对话框做铁证。
//   2) 连续 90 秒没有任何 page target，且进程有可见窗口 → 卡死（其它卡法兜底）。
//   3) 连续 150 秒没有任何 page target（不管有没有可见窗口）→ 卡死（硬上限）。
// 反向保护：
//   - 正常冷启动端口先开、page target 5 秒内就出现（实测 4.4~5.1 秒），
//     所以 8 秒 / 90 秒的门槛不会误杀「正在启动」的实例；
//   - 刚修过一次的冷却期内不再动手，避免上一实例的残余对话框把自己再杀一遍。
//     20 秒（原为 60 秒）：实测 60 秒纯粹在拖时间 —— 卡死实例通常紧跟在上一次
//     「裸跑→带端口」修复之后（19:10 那次就是等满 51 秒冷却才动手），
//     而残余对话框只可能属于一个已经死掉的进程，等 20 秒足够。
//     真正防「反复杀 Codex」的是看门狗里的熔断器（5 分钟 3 次 → 停手 10 分钟）。
//   - 关窗口后 Codex 会退出（不常驻托盘），所以「没有 page target」不代表正常待机。

export const STUCK_DIALOG_MIN_SEC = 8;
export const STUCK_VISIBLE_MIN_SEC = 90;
export const STUCK_HARD_MIN_SEC = 150;
export const STUCK_REPAIR_COOLDOWN_MS = 20000;
// 「端口开着、但 /json/list 请求本身失败或挂住」也算坏实例：实测这种坏法和
// 「/json/list 返回空数组」并存（同一台机器上 node 的 fetch 两种都出现过）。
// 它拿不到任何窗口证据，所以给一个较短的门槛 —— 但必须留足余量：
// 2026-10-17 19:27 实测一次正常冷启动「端口 2 秒开、page target 22 秒才出现」，
// 所以 30 秒太紧，改成 45 秒（正常实例的 DevTools HTTP 在端口开了以后立刻就能答）。
export const STUCK_LIST_FAIL_SEC = 45;

/**
 * @param {object} s
 * @param {number|null} s.pageTargets  当前 CDP page target 数量；null = 端口没开/取不到
 * @param {number} s.zeroTargetsSec    「端口开着但没有 page target」已持续秒数
 * @param {boolean} s.dialog           是否存在 #32770 对话框（启动失败铁证）
 * @param {number} s.visibleWindows    可见顶层窗口数量
 * @param {number} s.sinceRepairMs     距上次修复的毫秒数（Infinity = 从没修过）
 * @returns {{action:'none'|'wait'|'repair', reason?:string}}
 */
export function classifyStuck({
  pageTargets,
  zeroTargetsSec,
  dialog = false,
  visibleWindows = 0,
  sinceRepairMs = Infinity,
}) {
  if (pageTargets === null || pageTargets === undefined) return { action: "none", reason: "port-down" };
  if (pageTargets > 0) return { action: "none", reason: "healthy" };
  if (sinceRepairMs < STUCK_REPAIR_COOLDOWN_MS) return { action: "none", reason: "cooldown" };
  if (dialog && zeroTargetsSec >= STUCK_DIALOG_MIN_SEC) {
    return { action: "repair", reason: "start-failure-dialog" };
  }
  if (zeroTargetsSec >= STUCK_HARD_MIN_SEC) {
    return { action: "repair", reason: "no-page-target-hard" };
  }
  if (visibleWindows > 0 && zeroTargetsSec >= STUCK_VISIBLE_MIN_SEC) {
    return { action: "repair", reason: "visible-window-no-page-target" };
  }
  return { action: "wait", reason: "too-early" };
}
