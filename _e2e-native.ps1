$ErrorActionPreference = 'Continue'
$bg = $PSScriptRoot
$out = "$env:TEMP\wait-wallpaper.txt"
Remove-Item $out -ErrorAction SilentlyContinue

function PortUp { try { return (Invoke-WebRequest "http://127.0.0.1:9224/json/version" -TimeoutSec 2).StatusCode -eq 200 } catch { return $false } }
function NCodex { @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue).Count }

Write-Output ("baseline: port=" + (PortUp) + " procs=" + (NCodex))
Write-Output "killing ChatGPT..."
taskkill /F /IM ChatGPT.exe 2>&1 | Out-Null
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  if ((NCodex) -eq 0 -and -not (PortUp)) { break }
  Start-Sleep -Milliseconds 500
}
Write-Output ("after kill: port=" + (PortUp) + " procs=" + (NCodex))
if ((NCodex) -ne 0) { Write-Output 'ABORT: processes survived the kill'; exit 1 }

# start the waiter FIRST so it measures from the click
$w = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList @("$bg\_wait-wallpaper.mjs", '150') -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError "$env:TEMP\wait-wallpaper.err.txt"
Start-Sleep -Milliseconds 400

# click the NATIVE Codex taskbar pin the same way the shell does (Explorer is the parent)
$t = Get-Date
Start-Process explorer.exe 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App'
Write-Output ("clicked (native AUMID pin) at " + $t.ToString('HH:mm:ss'))

$null = $w.WaitForExit(160000)
Write-Output ("waiter exit=" + $w.ExitCode + " after " + [math]::Round(((Get-Date) - $t).TotalSeconds, 1) + "s")
Write-Output '--- waiter output ---'
Get-Content $out -Encoding UTF8 | ForEach-Object { Write-Output ("  " + $_) }
Write-Output '--- stderr ---'
Get-Content "$env:TEMP\wait-wallpaper.err.txt" -Encoding UTF8 -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { Write-Output ("  " + $_) }

Write-Output '--- watchdogs / injectors ---'
$cim = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -notlike '*subprocess-local*' }
$cim | Where-Object { $_.CommandLine -match 'codex-bg-watchdog|codex-bg\.mjs' } | ForEach-Object { Write-Output ("  PID " + $_.ProcessId + " :: " + $_.CommandLine) }
Write-Output ("  .watchdog.lock = " + (Get-Content "$bg\.watchdog.lock" -ErrorAction SilentlyContinue))
Write-Output ("  .injector.lock = " + (Get-Content "$bg\.injector.lock" -ErrorAction SilentlyContinue))
Write-Output '--- launcher.log (newest watchdog lines) ---'
Copy-Item "$bg\launcher.log" "$env:TEMP\launcher-copy.log" -Force -ErrorAction SilentlyContinue
Get-Content "$env:TEMP\launcher-copy.log" -Encoding UTF8 -Tail 16 | ForEach-Object { Write-Output ("  " + $_) }
