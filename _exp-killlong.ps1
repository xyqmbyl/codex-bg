# _exp-killlong.ps1 - controlled experiment (ASCII only; PS 5.1 safe).
# Phase 1: no Codex running -> COM activate with port -> is it healthy?
# Phase 2: instance fully initialized (60 s) -> taskkill -> COM activate -> healthy or stuck?
param([int]$Port = 9224, [int]$SettleSec = 6, [int]$RunSec = 60)

$ErrorActionPreference = "Continue"
$here = $PSScriptRoot
$log = Join-Path $here "_exp-killlong.log"
function L([string]$s) {
    $line = (Get-Date -Format "HH:mm:ss") + " " + $s
    Write-Output $line
    Add-Content -Path $log -Value $line -Encoding UTF8
}

function Get-PageTargets {
    try {
        $r = Invoke-WebRequest ("http://127.0.0.1:{0}/json/list" -f $Port) -TimeoutSec 2 -UseBasicParsing
        $j = $r.Content | ConvertFrom-Json
        return @($j | Where-Object { $_.type -eq "page" }).Count
    } catch { return -1 }
}

function Kill-App {
    & taskkill /F /IM ChatGPT.exe 2>&1 | Out-Null
    $ms = 0
    while ($ms -lt 20000) {
        if (@(Get-Process ChatGPT -ErrorAction SilentlyContinue).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 400
        $ms += 400
    }
    return (@(Get-Process ChatGPT -ErrorAction SilentlyContinue).Count -eq 0)
}

function Activate-Ported {
    & (Join-Path $here "launch-codex-debug.ps1") -Port $Port 2>&1 | ForEach-Object { L ("  activator: " + $_) }
}

function Wait-Healthy([int]$Sec) {
    $ms = 0
    while ($ms -lt ($Sec * 1000)) {
        $t = Get-PageTargets
        if ($t -gt 0) { L ("  HEALTHY at " + [math]::Round($ms / 1000, 1) + "s (page targets=" + $t + ")"); return $true }
        Start-Sleep -Milliseconds 1000
        $ms += 1000
    }
    L ("  STUCK: no page target after " + $Sec + "s (last=" + (Get-PageTargets) + ")")
    return $false
}

L "=== experiment start (settle=" + $SettleSec + "s, run=" + $RunSec + "s) ==="

# ---- phase 1: activate from nothing ----
L "phase 1: kill everything, settle, activate with port"
[void](Kill-App)
Start-Sleep -Seconds $SettleSec
Activate-Ported
$p1 = Wait-Healthy 25
L ("phase 1 verdict: " + $(if ($p1) { "HEALTHY" } else { "STUCK" }))

if ($p1) {
    L ("phase 2 setup: letting the instance run " + $RunSec + "s so it is fully initialized")
    Start-Sleep -Seconds $RunSec
    L ("phase 2: instance has been up " + $RunSec + "s; killing it and re-activating")
    [void](Kill-App)
    Start-Sleep -Seconds $SettleSec
    Activate-Ported
    $p2 = Wait-Healthy 30
    L ("phase 2 verdict: " + $(if ($p2) { "HEALTHY" } else { "STUCK" }))
}

L "final winstate:"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here "codex-bg-winstate.ps1") | ForEach-Object { L ("  " + $_) }
L "=== experiment end ==="
