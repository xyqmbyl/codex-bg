# ensure-codex-debug.ps1 - make Codex run WITH the Electron remote-debugging port open.
#
# WHY THIS EXISTS
#   The Codex desktop app is single-instance, and IApplicationActivationManager
#   ActivateApplication() routes an activation to an existing instance while
#   SILENTLY DROPPING the arguments. So a bare instance (opened from the native
#   taskbar pin / Start menu, no --remote-debugging-port) can never gain the port
#   without a restart. Activating an instance that is still shutting down behaves
#   the same way - and activating an already-running instance with arguments even
#   makes the app exit by itself within ~20 seconds.
#
#   The old launch path activated exactly once and then waited 90 seconds blindly.
#   A dropped-argument activation therefore cost the user ~2 minutes of a
#   wallpaper-less Codex before the watchdog retried and succeeded.
#
# PER ATTEMPT
#   0. if an instance carrying the port argument is already starting up, just wait
#      for its port - never kill it (the port needs 10-15 s on a cold start)
#   1. otherwise kill every ChatGPT.exe and WAIT until the process list is really
#      empty (activating while an instance is alive is what drops the arguments)
#   2. activate via COM with the port argument (launch-codex-debug.ps1)
#   3. verify from the live command lines whether the argument actually arrived,
#      and from the port whether it opened
#   4. retry at once on a dropped argument instead of waiting out a timeout
#
# EXIT CODES
#   0 = port is up, 1 = gave up after MaxAttempts
#
# -Force (added 2026-10-17)
#   Restart the app even when the port is already up. Needed because Codex can get
#   stuck in a state where the port IS open but the app never produces a CDP page
#   target at all: the only window is the Win32 dialog "ChatGPT failed to start."
#   (class #32770, body ERR_FAILED (-2) loading 'data:text/html...'), and the real
#   Chrome_WidgetWin_0 stays hidden. Such an instance looks healthy to a port-only
#   check, so the watchdog must be able to say "that port does not count".
#   With -Force the early exit and the "ported instance is already starting" wait
#   are both skipped, i.e. we always kill and re-activate.
#
# ENCODING: ASCII only. Windows PowerShell 5.1 reads BOM-less files as GBK, so any
# non-ASCII text in this file would be corrupted at parse time.

param(
    [int]$Port = 9224,
    [int]$MaxAttempts = 3,
    [int]$PortWaitSec = 30,
    [int]$ArgGraceMs = 8000,
    [switch]$Force
)

$ErrorActionPreference = "Continue"
$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$activator = Join-Path $here "launch-codex-debug.ps1"
$argFlag = "--remote-debugging-port=" + $Port

function Write-Note([string]$s) {
    Write-Output ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $s)
}

function Test-PortUp {
    # Codex 26.1106+ binds the debug port to [::1] (IPv6 loopback) only; older
    # builds bound 127.0.0.1. Try both loopbacks.
    foreach ($h in @("127.0.0.1", "[::1]")) {
        try {
            $r = Invoke-WebRequest ("http://{0}:{1}/json/version" -f $h, $Port) -TimeoutSec 2 -UseBasicParsing
            if ([int]$r.StatusCode -eq 200) { return $true }
        } catch { }
    }
    return $false
}

function Get-AppProcesses {
    return @(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" -ErrorAction SilentlyContinue)
}

function Test-PortedProcess {
    # True when some live ChatGPT.exe carries --remote-debugging-port=<Port>.
    # That is the only proof the COM activation really delivered the argument.
    foreach ($p in Get-AppProcesses) {
        if ($p.CommandLine -and $p.CommandLine.Contains($argFlag)) { return $true }
    }
    return $false
}

function Stop-App {
    # Kills the app and waits for a REAL process exit. Activations issued while an
    # instance is still alive get their arguments dropped, which is the whole bug.
    if ((Get-AppProcesses).Count -eq 0) { return $true }
    & taskkill /F /IM ChatGPT.exe 2>&1 | Out-Null
    $ms = 0
    while ($ms -lt 20000) {
        if ((Get-AppProcesses).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 400
        $ms += 400
    }
    return ((Get-AppProcesses).Count -eq 0)
}

function Invoke-Activate {
    try {
        $out = & $activator -Port $Port 2>&1
        Write-Note ("activate -> " + (((($out | Out-String).Trim()) -replace "\s+", " ")))
        return $true
    } catch {
        Write-Note ("activate threw: " + $_.Exception.Message)
        return $false
    }
}

function Wait-PortUp([int]$Sec) {
    $ms = 0
    while ($ms -lt ($Sec * 1000)) {
        if (Test-PortUp) { return $true }
        Start-Sleep -Milliseconds 500
        $ms += 500
    }
    return (Test-PortUp)
}

if (-not (Test-Path $activator)) {
    Write-Note ("FAIL: activator not found: " + $activator)
    exit 1
}

if ($Force) {
    Write-Note ("force restart requested (port may be up but the instance is unhealthy) - killing and re-activating")
} elseif (Test-PortUp) {
    Write-Note ("port " + $Port + " already up - nothing to do")
    exit 0
}

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    # A ported instance that is still cold-starting must NOT be killed: the port only
    # opens ~10-15 s into a start, and killing it here is exactly the old watchdog bug.
    # This also stops two repairs running at once (the taskbar launcher and the
    # watchdog both call this script) from destroying each other's fresh instance.
    if (-not $Force -and (Get-AppProcesses).Count -gt 0 -and (Test-PortedProcess)) {
        Write-Note ("attempt " + $attempt + ": a ported instance is already starting - waiting, not killing")
        if (Wait-PortUp $PortWaitSec) {
            Write-Note ("port " + $Port + " up (waited on the in-flight start)")
            exit 0
        }
        Write-Note ("attempt " + $attempt + ": ported instance alive but its port never opened - restarting it")
    }

    if (Stop-App) {
        Write-Note ("attempt " + $attempt + ": no ChatGPT.exe alive - activating with port")
    } else {
        Write-Note ("attempt " + $attempt + ": ChatGPT.exe survived taskkill - activating anyway")
    }
    Start-Sleep -Milliseconds 500
    [void](Invoke-Activate)

    $ms = 0
    $verdict = "timeout"
    while ($ms -lt ($PortWaitSec * 1000)) {
        if (Test-PortUp) {
            Write-Note ("port " + $Port + " up after " + $ms + " ms (attempt " + $attempt + ")")
            exit 0
        }
        if ($ms -ge $ArgGraceMs) {
            $n = (Get-AppProcesses).Count
            if ($n -gt 0 -and -not (Test-PortedProcess)) {
                # The app is coming up but nobody carries the port flag: the COM
                # activation dropped our arguments. Retry now, do not wait it out.
                $verdict = "args-dropped"
                break
            }
        }
        Start-Sleep -Milliseconds 500
        $ms += 500
    }
    if ($verdict -eq "args-dropped") {
        Write-Note ("attempt " + $attempt + ": activation dropped " + $argFlag + " - retrying")
    } else {
        Write-Note ("attempt " + $attempt + ": no port after " + $PortWaitSec + "s (ported process present: " + (Test-PortedProcess) + ")")
    }
}

Write-Note ("FAIL: port " + $Port + " not up after " + $MaxAttempts + " attempts")
exit 1
