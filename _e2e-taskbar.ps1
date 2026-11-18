# End-to-end acceptance test for: "click taskbar Codex -> wallpaper appears, without Codex auto-starting at boot"
# Simulates a real click on the NATIVE Codex taskbar icon (AUMID activation, no arguments = bare launch)
# and measures: bare start -> watchdog repair -> CDP port -> injector -> wallpaper.
# ASCII only (PS 5.1 reads BOM-less files as GBK).
param([int]$TimeoutSec = 150)

$root = $PSScriptRoot
$launcher = Join-Path $root 'launcher.log'
$injlog = Join-Path $root 'injector.log'
$start = Get-Date
$el = { param($m) '{0,7:n1}s  {1}' -f ((Get-Date) - $start).TotalSeconds, $m }

$logSize0 = (Get-Item $launcher).Length
$injSize0 = (Get-Item $injlog).Length

& $el 'T0 kill Codex (simulates "Codex not running")'
taskkill /F /IM ChatGPT.exe 2>&1 | Out-Null
$n = 0
while ((Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Measure-Object).Count -gt 0 -and $n -lt 40) { Start-Sleep -Milliseconds 500; $n++ }
& $el ("Codex fully exited after {0:n1}s" -f ($n * 0.5))

& $el 'T1 click native taskbar icon (= AUMID activate, NO arguments -> bare)'
Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'

$seenBare = $false; $seenRepair = $false; $portedSince = $null; $portSince = $null; $injSince = $null
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  $app = Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" -ErrorAction SilentlyContinue
  $ported = @($app | Where-Object { $_.CommandLine -like '*--remote-debugging-port=9224*' }).Count -gt 0
  if ($app.Count -gt 0 -and -not $ported -and -not $seenBare) { $seenBare = $true; & $el ("bare Codex up (pid {0}), no debug port" -f ($app[0].ProcessId)) }
  if ($ported -and -not $portedSince) { $portedSince = Get-Date; & $el ('ported instance present (cmdline has --remote-debugging-port=9224)') }
  $up = $false
  try { $r = Invoke-WebRequest 'http://127.0.0.1:9224/json/version' -TimeoutSec 2 -UseBasicParsing; $up = ($r.StatusCode -eq 200) } catch { $up = $false }
  if ($up -and -not $portSince) { $portSince = Get-Date; & $el 'PORT 9224 UP' }
  $inj = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*codex-bg.mjs*' -and $_.CommandLine -notlike '*subprocess-local*' }
  if ($inj -and -not $injSince) { $injSince = Get-Date; & $el ("injector alive (pid {0})" -f $inj[0].ProcessId) }
  $newLog = ''
  if ((Get-Item $launcher).Length -gt $logSize0) {
    $newLog = (Get-Content $launcher -Raw -Encoding UTF8).Substring($logSize0)
    if ($newLog -match 'bare Codex detected' -and -not $seenRepair) { $seenRepair = $true; & $el 'watchdog: bare Codex detected -> repairing' }
    if ($newLog -match 'reactivated Codex with port') { & $el 'watchdog: reactivated Codex with port' }
  }
  if ((Get-Item $injlog).Length -gt $injSize0) {
    $t = (Get-Content $injlog -Raw -Encoding UTF8).Substring($injSize0)
    if ($t -match 'ChatGPT') { & $el 'INJECTOR: injection reported for the ChatGPT window'; break }
  }
  Start-Sleep -Seconds 2
}

# main window visibility
Add-Type -Namespace E2E -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
'@
$win = Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if ($win) {
  foreach ($w in $win) {
    $h = [System.IntPtr]$w.MainWindowHandle
    & $el ("main window pid {0} hwnd {1} visible={2} minimized={3} title='{4}'" -f $w.Id, $h, [E2E.W]::IsWindowVisible($h), [E2E.W]::IsIconic($h), $w.MainWindowTitle)
  }
} else { & $el 'NO VISIBLE MAIN WINDOW' }

& $el '--- new launcher.log ---'
(Get-Content $launcher -Raw -Encoding UTF8).Substring($logSize0)
& $el '--- new injector.log ---'
(Get-Content $injlog -Raw -Encoding UTF8).Substring($injSize0)
