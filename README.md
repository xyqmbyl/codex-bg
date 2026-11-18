# codex-bg — 给 OpenAI Codex 桌面 app 铺壁纸

给微软商店版 OpenAI Codex 桌面 app（包名 `OpenAI.Codex_2p2nqsd0c76g0`，Electron）注入自定义
壁纸 + app 内「壁纸」设置面板。整体移植自 ZCode 桌面版壁纸工具
（[zcode-bg](https://github.com/xyqmbyl/zcode-bg)），注入路线：本地 CDP（127.0.0.1:9224）
→ `Runtime.evaluate` 打 CSS / 建媒体层。

## 快速使用

- **常驻看门狗（2026-09-30 起，开机自启）**：`codex-bg-watchdog.mjs` 每 2.5 秒巡检——发现 Codex
  裸跑（进程活着但命令行没有 `--remote-debugging-port=9224`）就**静默**交给
  `ensure-codex-debug.ps1` 修好端口，再让注入器挂壁纸（无弹窗，用户要求全程无感）；发现**卡死实例**
  （见下「卡死实例」一节）就强制重启；注入器死了自动补拉；config `enabled:false` 时整个休眠。
  开机自启 = **计划任务 `codex-bg-watchdog`**（`schtasks` 创建，动作
  `wscript.exe "…\codex-bg-watchdog-autostart.vbs"`，登录时触发、隐藏窗口）**＋** 启动文件夹那份
  `codex-bg-watchdog.lnk`（2026-10-17 起目标改指 `wscript.exe` 并把 .vbs 当**参数**，原因见坑清单：
  .lnk 直接指向 .vbs 会弹「打开文件 - 安全警告」而卡住不执行）。两条路都只启看门狗，15 秒锁去重。
  日志都在 launcher.log（`[watchdog]` 前缀）。
  **看门狗只做后台修复，不会在开机时自动启动 Codex**（用户明确要求，别改）。
- **唯一的「确保带端口」执行体：`ensure-codex-debug.ps1`**（2026-10-12 新增，纯 ASCII，被看门狗和
  `launch-codex-bg.vbs` 共用）：已有带端口的实例 → 只等，绝不杀；否则杀掉 → COM 激活带端口 → 轮询
  端口；若激活后 8 秒内进程活着但命令行仍没带端口，说明**参数被单实例语义丢掉了** → 立刻重试，
  最多 3 轮，成功 exit 0。**老代码的 bug 就出在这里**：杀完旧实例只 `Sleep 1500` 就重新激活，
  旧进程还没退干净 → 参数被丢 → 裸跑，然后盲等满 90 秒才报
  `FAIL: port not up after restart attempt` = 用户看到的「开了两分多钟没壁纸」。
- **带壁纸启动**：**直接点任务栏固定的「Codex Wallpaper」图标**
  （`%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Codex Wallpaper.lnk`
  → `launch-codex-bg.vbs`，图标就是 Codex 的）——Codex 没开 → 静默带端口启动 + 壁纸（**实测冷启动
  +5s 端口就绪、+8s 壁纸到位**）；裸跑 → 自动重启修复（聊天记录保留）；已带端口开着 → 仅
  `AppActivate` 置前，不动进程。注入器已活着时重复运行无害。**本目录没有桌面快捷方式**（旧版
  README 这么写过，实际只有任务栏图钉）。
- **原生 Codex 图钉现在也能用了**：注册表 `Taskband\Favorites` 里那个 AUMID 图钉
  （`OpenAI.Codex_2p2nqsd0c76g0!App`）激活时**不带任何参数**，必然开出裸跑实例，MSIX 图钉又没法
  加参数——所以只能事后修：看门狗检测到裸跑后调 `ensure-codex-debug.ps1` 重建带端口实例，
  **实测 +6.2s 端口就绪、+9s 壁纸到位**（从前是 ~150 秒甚至永远裸跑，见下）。任务栏上运行中的
  Codex 窗口按钮和固定图标长得一模一样，现在**点哪个都能在 ~10 秒内拿到壁纸**。
- **移除壁纸**：关掉注入器窗口，或 `node codex-bg.mjs --off`（样式和设置面板立即撤掉，恢复原样）。
- **换壁纸 / 调效果**：Codex 里点侧栏「壁纸」入口（在「项目」组上方，原生导航项样式），
  或设置页 →「外观」附近的「壁纸」入口。面板支持选图/选视频/拖拽换壁纸、
  铺排/对齐、面板透明度、压暗、模糊、锐化、Wallpaper Engine 工坊导入。
- **单独调左侧栏背景**：壁纸面板 →「显示效果」→「左侧栏不透明度」，0% 与聊天区一样
  通透，100% 为实心背景；拖动立即预览，松手后自动保存。点「与聊天区一致」恢复 0%。
  此项独立于「面板不透明度」，只改侧栏背景，文字、图标和选中项保持原来的样式。
- **输入框和添加菜单**：同一「显示效果」区还有「输入框不透明度」和「添加菜单不透明度」，
  各自独立调节并保存，默认均为 0%。菜单标题背景随菜单处理，按钮的悬停和选中反馈仍保留。
  每项都有「与聊天区一致」按钮；只调整背景，文字、图标及输入功能保持正常。
- **右上角输出内容浮窗**：同一区域的「输出内容浮窗不透明度」独立调节浮窗背景，默认 0%，
  拖动立即预览并自动保存；「与聊天区一致」恢复 0%。标题背景一并透明化，文字与按钮保持清晰。
- 手动流程（排查用）：
  1. `powershell -NoProfile -ExecutionPolicy Bypass -File ensure-codex-debug.ps1 -Port 9224`
     （一条命令修端口，裸跑实例也能救；exit 0 = 端口起来了，1 = 3 轮都没成）
  2. 还不行才手动重来：`taskkill /F /IM ChatGPT.exe`（必须**完全退出**，见坑清单），
     再 `powershell -NoProfile -ExecutionPolicy Bypass -File launch-codex-debug.ps1 -Port 9224`
  3. `node codex-bg.mjs --attach`（常驻，> injector.log；`--check` 自检、`--diagnose` 诊断）

## 架构事实（换 app 版本时先读这段）

- Codex 桌面 app = Electron，主进程 `ChatGPT.exe`，主窗口 CDP 目标 `app://-/index.html`
  （React + Tailwind，主容器 `#root`）。微软商店包路径
  `C:\Program Files\WindowsApps\OpenAI.Codex_<版本>_x64__2p2nqsd0c76g0\app\ChatGPT.exe`。
- **启动只能走 COM 激活**（AUMID `OpenAI.Codex_2p2nqsd0c76g0!App`，脚本
  `launch-codex-debug.ps1`，可附带命令行参数）。直接双击 WindowsApps 里的 exe 会报
  「该进程没有程序包标识符」。
- **单实例语义（所有「打不开壁纸」的根源）**：app 在跑时激活会被路由给现有实例、**新参数被静默
  丢弃**，而且**丢掉端口这件事永远补不回来**，只能完全退出后重新激活。`ensure-codex-debug.ps1`
  就是照这条语义写的：杀掉旧实例 → 轮询确认它**真的退干净**（最多 20s）→ 激活 → 若命令行仍没带
  端口就当场判定「参数被丢」立刻重试（最多 3 轮），不再盲等。
- **现在的启动/修复链路（谁调谁）**：`看门狗 codex-bg-watchdog.mjs`（2.5s 轮询，只后台修复）和
  `任务栏图钉 → launch-codex-bg.vbs` 都只干一件事——把「确保 9224 带端口」交给
  `ensure-codex-debug.ps1`；端口起来后 `codex-bg.mjs --attach`（注入器，常驻，写 `.injector.lock`）
  在 attach 时注入壁纸。看门狗发现「进程在、端口没了」就调 ensure；发现注入器死了就补拉
  （日志 `injector dead - respawning`）。三条入口（Codex Wallpaper 图钉 / 原生 AUMID 图钉 /
  已开着的窗口）最终都收敛到这条链路，所以任一路径都不再需要用户分辨点哪个图标。
- **调试端口 9224**：9222 被 ZCode 的 zcode-bg 占用、9223 被 Edge「统筹面板」占用。
  config.json 的 debugPort=9224、mediaPort=19765。
- 壁纸链路：图片内嵌 data-URL 画在 `html` 的 background-image 上（`background-attachment:fixed`）；
  视频/网页壁纸走 z-index:-2 的 `<video>`/`<iframe>` 层；压暗层是 `body::before`（z-index:-1）。

## 聊天区透明化的内置规则（cssFromState）

壁纸在最底层，这些原生表面必须挖空/改半透明，壁纸才能透出来（Codex 26.924 真机实测；
CSS Module 的 hash 类用前缀匹配，不写死 hash）：

| 选择器 | 处理 | 是什么 |
|---|---|---|
| `main[class*="_MainContentSurface_"]` | 强制透明 | 聊天主表面，原生 #181818 实心（黑底元凶） |
| `[class*="_MainContentTopFade_"]` | 强制透明 | 主区顶部实心渐变 |
| `[class~="group/thread-scroll-layout"] [class*="_background_"][class*="_surface_"]` | 强制透明 | 会话底部的实心背景板（2026-10-28 实测） |
| `[class~="group/thread-scroll-layout"] [class*="_background_"][class*="_fade_"]` | 清除渐变 | 会话滚动区底部渐变（2026-10-28 实测） |
| `:is([class^="footer-"],[class*=" footer-"],[class*="_footer_"]):has([data-composer-surface-variant])::before / ::after` | 清除背景和渐变 | 新版会话底部伪元素（2026-11-19 实测），保留输入框独立透明度 |
| `[data-composer-surface-variant][data-composer-layout]` | 独立背景不透明度 | 输入框，`composerAlpha` 默认 0 |
| `[data-composer-surface-variant] [data-composer-body]` | 强制透明 | 避免输入框内外背景叠加，覆盖旧版 `.42` 的自定义规则 |
| `[data-composer-overlay-floating-ui] [class*='_suggestionMenu_']` | 独立背景不透明度 | 添加/插件菜单，`menuAlpha` 默认 0，标题背景透明 |
| `[data-summary-panel-variant="summary"][data-summary-panel-density]` | 独立背景不透明度 | 输出内容浮窗，`outputAlpha` 默认 0，标题及其背景伪元素透明 |
| `div.bg-surface.sticky` | color-mix 55% 透明 | 会话页 sticky 顶栏 |
| `#app-shell-sidebar [data-sidebar-navigation-root]` | 独立背景不透明度 | 左侧栏背景，`sidebarAlpha` 取值 0～1、默认 0（完全通透） |

选择器用前缀匹配、不写死 hash，Codex 小版本升级大概率不用改；若某天壁纸又被盖住，
先用 CDP（`Runtime.evaluate`）跑 `document.elementsFromPoint(窗口中心)` 找新表面的
class，把选择器补进 `cssFromState` 的 `BUILTIN_FORCE_TRANSPARENT` / `BUILTIN_RECOLOR`
（codex-bg.mjs），再抬 UI_VERSION 重启注入器。
`pointer-events:none` 的底板和渐变不会出现在命中测试结果中，还需查询 DOM 并检查
`getComputedStyle()`（包括 `::before` / `::after`）的 `backgroundColor` / `backgroundImage`；可参考 `_verify-chat-surface.mjs`。

## 改 ui-inject.js / wc-player.js 的规矩

- `UI_VERSION`（codex-bg.mjs 第 51 行）必须 +1，页面侧才会重建 UI；同版本重注入只
  setState，改了代码不抬版本等于没改。`wc-player.js` 另有一道自己的守卫
  `if (window.__zcodeBgVideoWc && window.__zcodeBgVideoWc.__v === N) return;`（现 `__v = 3`），
  改播放器时一起抬。
- **不用重启注入器也能让改动生效**：注入器每轮轮询 config.json 的 mtime
  （`reloadConfigIfChanged()`，codex-bg.mjs:4819 起），mtime 一变就对所有已 attach 的窗口
  重新走一遍 `applyToWindow()`（重读盘上的 `ui-inject.js` / `wc-player.js`、重注入脚本）。
  所以 `(Get-Item config.json).LastWriteTime = Get-Date` 就是一次软重载
  （沙箱里枚举/杀 node 进程会被拒，这是唯一可行的重注入手段）。
- **修改 `codex-bg.mjs` 本体时需重新启动注入器**：config 热加载仍使用进程内已加载的
  `cssFromState` 等函数，不能加载本体的新代码。先核对 `.injector.lock` 中 PID 的命令行确实为
  `codex-bg.mjs --attach`，只停止该注入器，让常驻看门狗自动补拉；无需重启 Codex。
- 会话底部透明化可在打开会话后运行 `node _verify-chat-surface.mjs` 验证：检查底板颜色与
  渐变均已清除，输入框仍保留布局。
- 侧栏控件可运行 `node _verify-sidebar.mjs` 验证；加 `--exercise` 会操作真实滑块测试
  实时预览与保存，并点「与聊天区一致」恢复 0%。
- 输入框与添加菜单可运行 `node _verify-composer-menu.mjs --exercise`，测试真实菜单、两项滑块
  的实时预览/独立保存及恢复 0%，包括旧版自定义 CSS 的优先级与菜单标题背景；结束后还原测试前数值。
- 输出内容浮窗可运行 `node _verify-output.mjs --exercise`，验证背景独立预览、保存、恢复 0%
  及标题背景透明化；运行时需打开输出内容浮窗，结束后还原测试前数值。
- 内部样式 id `__zcode_*` 和 `STYLE_ID`/`LAYER_ID` 前缀与 zcode-bg 保持一致，别改。

## 侧栏入口（v42 起）

入口不再是浮层药丸，而是真正插进侧栏 DOM 流：`embedNavInSidebar()` 首选原生「探索」按钮
（`button.sidebar-item`，文本=探索/Explore），把「壁纸」插在它**后面**——和原生项同一父容器、
同一列、同样的 `px-row-x` 行内边距（x=8、宽 260 和原生行完全一致），视觉上正好在「项目」组上方。
「探索」不配合时退到「项目」section 锚点（v41 的做法，宽 276 会比原生行宽 8px），
再退到模板按钮「新聊天」下一行。设置页打开时 `unembedNav()` 把入口搬回浮层贴到「外观」旁边；
React 重渲染吃掉节点时 tick（~500ms 一轮）会重新插；`destroy()` 会把被 re-parent 的入口单独摘除。

## 视频壁纸（v45 实测结论：原生 `<video>` 就能播）

**结论：视频壁纸是真在播的，走的是原生 `<video>`，不是 WebCodecs。**（此前「Codex 壳不带
ffmpeg.dll → `<video>`/`<audio>` 全废、readyState 永远 0」的结论是**误判**，已作废。）

实测证据（全部 CDP 断言，不靠人眼）：

- `getVideoPlaybackQuality().totalVideoFrames` 2576 → 2641（2.16s）≈ **30fps**；
  `requestVideoFrameCallback` 报 mediaTime 0.5 → 0.533 → 0.567、presentedFrames 递增。
- `#__zcode_bg_video` 恒 `readyState 4`、`videoWidth/Height 3200×1800`、`duration 24`、
  `currentTime` 持续推进、`networkState 1`、`buffered [0,24]`、`error null`。
- 可见性：`_shot.mjs` 截图 3.6MB；把视频层 `visibility:hidden` 后 224KB，`_pixdiff.ps1`
  报 98.6% / 98.99% 采样像素变化、diffBBox 覆盖整窗 → 它就是全窗壁纸。
- 运动幅度：连续两张截图（间隔 1.2s）差 **1.88%** 采样像素。当前壁纸（夜刀神十香）本身就
  近乎静止（原生控件 drawImage 对照实测只有 0.6–0.7%/4s）——**「画布均值不变」不等于没在播**，
  别再拿全画布均值判死活。

**壳的解码能力是完整的**（`_diag-media.mjs` 实测）：`canPlayType('video/mp4; codecs="avc1.640033"')`
= `probably`，mp3/aac = `probably`，合成 PCM WAV blob → `loadedmetadata` / readyState 4，
`MediaSource` 与 `AudioDecoder` 均存在。

**历史 `readyState 0` 的真实原因（判定，非完整 A/B）**：页面 meta CSP `default-src 'none'`，
其中 `media-src 'self' app: blob: data: https:` 和 `connect-src 'self' https://…` **都不含 `http:`**，
而媒体服务是 `http://127.0.0.1:19765` → 媒体加载/库读取被 CSP 拦。v43 起 `attachTo()` 里
`Page.setBypassCSP(true)` + 「页面没有注入痕迹就 reload 一次」才是解开它的那一步
（这也解释了当年的「读取壁纸库失败」；v43 注释里「setBypassCSP 只对之后加载的文档生效」是同一件事）。

- `setBypassCSP(false)` 对**已加载**的文档不生效（bypass 是加载期语义），所以拿现成页面做
  on/off 对照测不出差别：`_diag-csp3.mjs` 在 bypass 关闭下测 http / blob / data 三种 URL
  **全都是 loadedmetadata / readyState 4**。要真做这个 A/B 得 reload 文档——而 reload 会让
  页面丢掉壁纸状态（注入器只在 attach 时注入一次），别为了验这个把现场搞乱。
- 浮层小窗 `?initialRoute=%2Favatar-overlay` 同样被注入（`window.__zcodeBg` 存在），
  也不能当「未 bypass 的对照组」（`_diag-csp2.mjs`）。

### 兜底路径：`wc-player.js`（WebCodecs，保留但当前用不到）

- 组成：系统 Media Foundation 硬解（`VideoDecoder`，不依赖 ffmpeg）+ 自写**非分片** MP4 分包器
  （stsd/avcC→codec、stts→DTS、ctts、stss、stsz、stsc、stco/co64）+ canvas
  `#__zcode_bg_video_wc` 的 cover 渲染。运行时经 `wcPlayerSource()` 从盘读源码拼进注入串
  （codex-bg.mjs:2741 / 3031），每次重注入都重读。
- 触发条件（codex-bg.mjs:2037 / 2054-2074）：**只有换了壁纸、`src` 变了**才起 8 秒兜底定时器；
  8 秒后 `#__zcode_bg_video` 不存在或 `readyState < 2` 才 `__zcodeBgVideoWc.start(cfg)`，
  失败回调 `fbShow(cfg)` 用工坊 `preview.jpg` 顶静帧；一旦 `canplay` 响就 `stop()` 让位给原生
  `<video>`（codex-bg.mjs:2039-2051）。手动拉起调试：
  `window.__zcodeBgVideoWc.start(window.__zcodeBgVideoCfg)`，看 `active()/painted()/__zcodeBgVideoWcLastErr`。
- **v45 修的 bug**：分包器读 `stsc` 记录时按 8 字节步进，实际每条 **12 字节**
  （first_chunk / samples_per_chunk / sample_description_index 三个 u32）→ 第 2 个 chunk 起的
  样本偏移全歪、喂给解码器的是垃圾字节 → 第 7 个样本必 `EncodingError`、decoder `state` 变
  `closed`。上一轮据此误判成「该壳对 B 帧连续解码有缺陷」。
- 修复后实测：`shixiang.mp4` 真身是 **720 帧 / 24s / 4 个关键帧（stss = 1,193,385,577）/ 3200×1800 /
  带 B 帧（ctts 484 条）**（此前「48 样本 / 1 关键帧 / 1.6s」是 stsc bug 的产物）；
  `_diag-wcfeed.mjs` 页面内喂满 720 样本 → 出 719 帧、err null；`_diag-nal.mjs` 校验 4 个真实
  工坊视频（shixiang / tohka / I / 0201）**0 个坏样本**、末样本偏移正好等于文件尾。
- 待办小瑕疵：`wc-player.js` tick 里 `performance.now() - r.lastDrawn > 400000`（400 秒，
  疑为 400ms 笔误），只影响兜底路径的「强制补画一帧」。

媒体令牌 URL：`http://127.0.0.1:19765/w/<sha1(绝对路径小写).hex 前 16 位>`
（`mediaTokenFor`；shixiang.mp4 = `/w/ec36b23ff19476c7`）；另有 `/wallpaper/<file>` 直读路由。

## 卡死实例：怎么认、怎么修（2026-10-17 新增）

第三种坏法，比「裸跑」更阴：**端口 9224 是开的，但一个 `app://-/index.html` page target 都没有**。
看门狗（以为端口通了就万事大吉）和注入器（`一直没能连上 Codex 的渲染进程，退出。`）双双沉默空转，
用户点任务栏图标看到的就是「没反应、没壁纸」。判据集中在 `codex-bg-stuck.mjs`（纯函数，单测
`_test-stuck.mjs` 21/21），看门狗 import 它：

| 常量 | 值 | 含义 |
|---|---|---|
| `STUCK_DIALOG_MIN_SEC` | 8 | 看得见错误对话框（窗口类 `#32770`，标题 `ChatGPT failed to start.`）撑过 8 秒 → 立刻修 |
| `STUCK_VISIBLE_MIN_SEC` | 90 | 有可见 Codex 窗口却始终没有 page target，90 秒 → 修 |
| `STUCK_HARD_MIN_SEC` | 150 | 压根没有可见窗口，150 秒 → 修 |
| `STUCK_LIST_FAIL_SEC` | 45 | 端口开着但 `/json/list` **请求本身失败或挂住**（`targets === null`）→ 修 |
| `STUCK_REPAIR_COOLDOWN_MS` | 20000 | 两次修复之间的最小间隔 |

- 零 target 的判定要配合窗口证据（`codex-bg-winstate.ps1` 枚举窗口，每 5 秒最多查一次），
  正常冷启动期间「端口已开、页面还没出来」也会是零 target——所以 8 秒那条必须**同时**有可见对话框。
- **修复必须带 `-Force`**：`ensure-codex-debug.ps1` 默认「端口开着就直接早退」、并且「带端口的实例正在
  冷启动就先等、绝不杀」，这两条保护对卡死实例正好是错的。`-Force` 跳过它们 → 杀掉重来。
- 死循环保护：5 分钟内修了 ≥3 次 → 退避 10 分钟（`backoffUntil`），退避期间只打一行日志说明卡在哪，
  不会疯狂杀进程；另外主循环如果一轮超过 90 秒没跑完，会打
  `watchdog main loop has not completed a round for Ns - it looks stuck`。
- 每 60 秒打一行状态（端口/target 数/窗口数/注入器活着没），排查时先看这行。
- **别把门槛调小**：2026-10-17 19:27 实测一次**正常**冷启动——`-Force` 杀掉后端口 2 秒就开，
  但 page target 直到 **22 秒**才出现（此前有过「端口 2 秒开」的经验，容易误判成卡死）。
- 这毛病是**偶发**的：同一天里「从零启动」和「杀掉开了 60 秒的实例再启动」（`_exp-killlong.ps1`）两条
  路径都是 HEALTHY，而 19:10:41 的一次真实触发是「可见对话框 + 1 个可见窗口」；17:58 那次裸跑实例
  更是**~6 分钟一个渲染进程都没有**（窗口全隐藏，MainWindowHandle=0）之后自己恢复了——所以修复走
  「检测到症状就强制重启」，不做「原因复现」那一套。



## 坑清单（实测）

- **启动文件夹里的 .lnk 直接指向 .vbs 会弹「打开文件 - 安全警告」并卡住不执行**（2026-10-17 定位）：
  窗口类 `#32770`、宿主进程是 `powershell`、对话框自己是隐藏的，所以「看起来什么都没发生」。
  改成 .lnk 目标 = `C:\WINDOWS\system32\wscript.exe`、`.vbs` 路径当**参数**、工作目录 = 本目录
  （跟任务栏图钉一模一样的写法）就不再弹。**这就是看门狗「开机没起来」的根因**——别再用
  「.lnk → .vbs」这种写法，`.vbs` 本身的关联（`.vbs` → `VBSFile` → `wscript.exe "%1" %*`）和
  WSH 策略都是好的（`HKCU/HKLM\Software\Microsoft\Windows Script Host\Settings` 的 `Enabled` 为空 =
  没被禁），MOTW 也已排除。
- **PowerShell 5.1 读无 BOM UTF-8 的中文注释会按 GBK 解析出错**——新 .ps1 必须纯 ASCII
  或 UTF-8 BOM；.vbs 同理（WSH 按 ANSI 读），本目录脚本全部纯 ASCII。
- Git Bash 内联 `node -e "..."` 的引号/反斜杠会被吃掉——探针一律写成 .mjs 文件再跑。
- **9224 上有两个 `app://` page 目标**：`app://-/index.html?initialRoute=%2Favatar-overlay`
  （头像浮层小窗，常年 811×970）和主窗口 `app://-/index.html`。CDP 探针/注入必须精确匹配
  `url === "app://-/index.html"`，`startsWith("app://")` 会抓到浮层窗、误判侧栏丢失。
- 9222 被 ZCode 的 zcode-bg 占用、9223 被 Edge「统筹面板」占用，Codex 固定 9224。
- **Codex 自己也有一个 MSIX 自启动任务**（「开机自动启动 Codex」的来源）：状态在
  `HKCU\Software\Microsoft\Windows\CurrentVersion\AppModel\SystemAppData\OpenAI.Codex_2p2nqsd0c76g0\App`
  的 `State`（WinRT 枚举：0=Disabled / **1=DisabledByUser** / 2=Enabled / 3=DisabledByPolicy /
  4=EnabledByPolicy）；WinRT 读写入口是 `[Windows.ApplicationModel.StartupTask]::GetAsync('App')`
  （见 `_disable-codex-startup.ps1`）。**当前 = 1（用户要求开机不要自动启动 Codex）**。另外
  注册表里还有 `HKCU\…\Winlogon\RestartApps`（「重新登录后自动重启应用」），本机没这个值 = 关。
- app 裸跑时再 COM 激活**不会**补上参数（单实例语义，参数被静默丢弃）——必须**完全退出**再激活；
  原生 AUMID 图钉（`Taskband\Favorites` 里那个）天生不带参数，只能靠看门狗事后修复。
- 媒体服务端口 19765（页面 CSP 不含 `http:`，见上面「视频壁纸」一节；页面里 fetch/媒体能过是因为
  注入器 attach 时开了 `Page.setBypassCSP`）。**探针自己不要 `Page.reload`**：reload 会清掉页面上
  的东西，而注入器不会自动重注入（只在 attach 时注入一次），reload 后要么 `(Get-Item config.json).LastWriteTime = Get-Date`
  软重载，要么重启注入器。
- 受限沙箱里 `tasklist` / `Get-Process -Name node` / `Stop-Process -Id <PID>` 会被拒（进程枚举
  不可见），那种会话里重启注入器走不通，改用上面的 config.json mtime 软重载。**danger-full-access
  会话不受限**（2026-10-12 实测 `Get-CimInstance Win32_Process` / `taskkill` / `Start-Process`
  都能用，端到端实测就是这么做的）。
- 从工具里枚举进程**注意自匹配**：harness 自己的 `runner.js` 命令行里带着你刚写的脚本文本（比如
  `codex-bg-watchdog.mjs`），`CommandLine -match 'codex-bg-watchdog'` 会把这个假进程一起列出来
  （本会话就被骗过一次，误以为跑着两个看门狗）——用 `-notlike '*subprocess-local*'` 过滤，或核对
  完整命令行。
- **读日志的坑**：`injector.log` 被注入器占着句柄，`[System.IO.File]::ReadAllBytes` 会抛
  `IOException: ... being used by another process`——先 `Copy-Item` 到 `$env:TEMP` 再读；它由
  `cmd >>` 重定向写入，**是 GBK（codepage 936）**，按 UTF-8 读全是乱码。`launcher.log` 由 node
  写，是 **UTF-8**（`[watchdog]` 前缀的行都在里面）。只想看新增行就先记下文件长度，再用
  `$fs.Seek(<旧长度>,'Begin')` 取尾部字节。
- **窗口被盖住/最小化时一切都「静止」是正常现象**：`document.hidden=true` 时
  `pauseWhenHidden` 暂停 `<video>`、wc 播放器停 rAF+pump，像素 diff 全平、`play()` 还会被
  后台媒体策略拒（`AbortError: video-only background media…`）。**别把这当播放坏了**。
  注意**遮挡也算 hidden**（2026-10-12 实测：窗口在别的窗口后面时 `document.hidden=true`、
  `currentTime` 不推进，把它置前后 2 秒推进 2.01s、7.38→9.39 正常）——**验播放前必须先把窗口
  放到最前**。
  让页面活过来的第一选择是 CDP `Page.bringToFront`（秒生效，`document.hidden` 变 false）；
  但它**拉不回已最小化的原生窗口**——那种情况先取 `Get-Process ChatGPT | Where MainWindowHandle
  -ne 0`，再 `ShowWindow(hwnd, 9)`（SW_RESTORE）+ `SetForegroundWindow(hwnd)`，本会话实测有效
  （`GetForegroundWindow()` 变成该 hwnd，随后 `_probe-front.mjs` 报 `hidden:false` 且推进）；
  `SetWindowPos` TOPMOST 压不过 Chrome 的遮挡检测，别用。
- **`_verify-video.mjs` 的「夜刀神十香（视频）」卡片已不存在**（工坊库状态变了，卡片现在叫
  「夜刀神十香（静帧）」等），跑它会 `click: NO-CARD`——用 `_probe-front.mjs` 直接验播放，
  或把点卡片改成任意 `（视频）` 结尾的 title。
- Wallpaper Engine 工坊：`<SteamLibrary>\steamapps\workshop\content\431960`（`431960` 是
  Wallpaper Engine 的 Steam App ID），工坊壁纸放这里；工具会自动发现，也可在 `config.json`
  的 `weDir` 手动指定。
- 界面是英文时透明化清单不受影响，但侧栏入口锚点按中文文本（新聊天/项目）找，
  英文界面会退到「新聊天」下一行的浮层钉位，功能不受影响。

## 启动链路端到端实测（2026-10-12 那次的做法，以后再验照这个来）

前提：能枚举/杀进程的会话（danger-full-access）。全程只看日志 + CDP 断言，不靠肉眼。会重启
Codex（聊天记录保留）。

1. 记基线：`http://127.0.0.1:9224/json/version` 通不通、`Get-CimInstance Win32_Process -Filter
   "Name='ChatGPT.exe'"` 几个进程、`launcher.log` / `injector.log` 的当前字节数。
2. 杀干净：`taskkill /F /IM ChatGPT.exe`，轮询到进程数 = 0。
3. 点图标——**必须让 Explorer 去点**：直接 `Start-Process` 起的进程会挂在本会话这次工具调用的
   job 里，job 一结束就被一起收走（本会话就是因此误判「看门狗没在跑」）。用
   `Start-Process explorer.exe 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'`（原生 AUMID
   图钉路径）或 `Start-Process explorer.exe "<…\User Pinned\TaskBar\Codex Wallpaper.lnk>"`（固定
   图钉路径），父进程是 Explorer，跟登录时 shell 激活一模一样，能长期活着。
4. 量两个时间点：端口就绪（轮询 `/json/version`）+ 壁纸到位（`injector.log` 出现新的 `✅ 已注入`，
   **按字节偏移取尾部的，别把旧行当新行**——本会话就吃过一次这个假阳性）。
5. 验播放：`node _probe-front.mjs`（先把窗口置前，见坑清单）。
6. 收尾：确认只剩一个看门狗 + 一个注入器（`.watchdog.lock` / `.injector.lock` 里的 PID 对得上）。

实测结果：固定图钉 **+5s 端口 / +8s 壁纸**；原生 AUMID 图钉 **+6.2s 端口 / +9s 壁纸**。
改之前那条路径是「裸跑 → 盲等 90s → `FAIL: port not up` → 再等一轮」≈ 150s，甚至一直没壁纸。

**2026-10-17 复测（原生 AUMID 图钉，用现成探针 `_wait-wallpaper.mjs`）**：19:38:08 点图标 → 19:38:10
看门狗就报 `bare Codex detected` → 19:38:15 带端口重激活（**端口 +7.2s**）→ 19:38:17 拉起注入器 →
**page target +43.1s / 壁纸 +44.1s**。这 44 秒**全是 app 自己的冷启动慢**（端口 7 秒就开了，主窗口的
`app://-/index.html` target 43 秒才出现），不是注入链的问题——所以别拿单次数字当回归基准，
`_wait-wallpaper.mjs` 会分别打印 port / page / wallpaper 三个时间点，慢在哪一眼能看出来。
「点图标 → 看门狗发现裸跑 → 修复」这条链 2 秒内就触发了，这是要守住的部分。
验证 `-Force` 强制重启（端到端测试卡死路径用）：
`powershell -NoProfile -ExecutionPolicy Bypass -File ensure-codex-debug.ps1 -Port 9224 -Force`
（日志会出现 `force restart requested (port may be up but the instance is unhealthy) - killing and re-activating`）。

## 验证思路与现成探针

全部走 CDP 断言，不靠人眼看图：
1. `fetch http://127.0.0.1:9224/json` 找 `app://` page（**精确等值** `url === "app://-/index.html"`），
   WebSocket + `Runtime.evaluate`（send 层已解包一次，取值用 `r.result.value`）。
2. 表面扫描：遍历 `body *`，`getComputedStyle` 找面积 >8000px² 且背景不透明的元素。
3. `Page.captureScreenshot` 存 PNG → PowerShell `System.Drawing` 的 `GetPixel` / 采样比对：
   窗口中心像素应是壁纸色（当前壁纸下 ≈ #352862 紫渐变），修复前是 #181818。
4. 面板断言：`.zcbg-panel` display=flex、按钮/开关/滑块计数、ESC 和 ✕ 关闭。

本目录里可直接复用的探针（纯 ASCII/ESM，`node <文件>` 就跑）：

| 探针 | 作用 |
|---|---|
| `_shot-cdp.mjs` | CDP 截图 + 页面状态探针一次搞定（`node _shot-cdp.mjs <out.png>`，输出 htmlBgImage/`<video>` readyState、尺寸、version 等；**用 Node 全局 `WebSocket`，不需要 `ws` 包**） |
| `_shot-codex.ps1` | 用 PrintWindow 抓原生窗口（不吃遮挡/能在窗口被别的窗口盖住时也拍到）；窗口是隐藏/最小化时它会报 `no visible Chrome_WidgetWin_1 window for ChatGPT`，改用 `_shot-cdp.mjs` |
| `_test-stuck.mjs` | `codex-bg-stuck.mjs` 判据的单测（21 条全过；改门槛后跑一遍） |
| `_probe.mjs` | 通用 CDP 求值：`node _probe.mjs "<表达式>" [timeoutMs]` |
| `_verify-video.mjs` | 视频壁纸端到端：开面板→点「夜刀神十香（视频）」卡片→等 15s→查 `active()/painted()`、canvas opacity、readyState →两次像素和对比→`verify-we-video.png`（注意：十香视频卡片已不存在，见坑清单） |
| `_probe-front.mjs` | `Page.bringToFront` + 播放断言：visibility、`play()`、currentTime 2s 推进量（窗口若被最小化/遮挡会假阴性，先置前） |
| `_probe-fulldec.mjs` | 页面内全量解码压测：喂满全部样本（shixiang 720/720、720 帧全出、flush ok） |
| `_probe-wcplay.mjs` | wc 播放器端到端：手动 `start()`→painted→画布像素变化→`stop()` |
| `_shot-pair2.mjs` | bringToFront + 截图 ×2（verify-we-video-A/B.png），配合 `_pixdiff.ps1`（同样先置前，否则两张图全平） |
| `_probe-state.mjs` / `_probe-video.mjs` | 快查：注入版本 / `<video>` 元素与 wc 播放器状态 |
| `_shot.mjs` | 截图（可传 clip），产物给 `_pixdiff.ps1` 比对 |
| `_pixdiff.ps1` | System.Drawing 双图采样比对：差异比例 / 去重色数 / diffBBox |
| `_reload.mjs` | `Page.reload` 后轮询注入状态（验完记得 config.json 软重载恢复） |
| `_diag-media.mjs` | 壳的媒体能力：canPlayType 广告 + 合成 PCM WAV 能否 loadedmetadata |
| `_diag-csp2.mjs` / `_diag-csp3.mjs` | CSP 相关对照（浮层窗页面策略 / bypass 关闭下的 http·blob·data 媒体） |
| `_diag-nal.mjs` | Node 侧校验分包器：逐样本走 [4 字节长度][NAL] 链，报坏样本、关键帧、pts 单调性 |
| `_diag-box.mjs` | dump 顶层 box 布局 + 各 trak 的 stsc/stsz/stts/stss/ctts/stco 全表 |
| `_diag-wcfeed.mjs` | 页面内喂满全部样本给 `VideoDecoder`（压测解码稳定性） |
| `_diag-wcstall.mjs` | 给 `drawImage`/`decode` 打计数补丁，看 wc 播放器是否真在出帧 |
| `_diag-wcmove.mjs` / `_diag-wcdense.mjs` | 全画布像素快照对比（步长 3973 / 40） |
| `_diag-ctrl.mjs` | 原生控件 drawImage 到 960×540 离屏 canvas 做运动幅度对照 |
| `_diag-panel3.mjs` | 设置面板 DOM 结构 |
