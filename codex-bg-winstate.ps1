# codex-bg-winstate.ps1 - report top-level windows of ChatGPT.exe as compact JSON.
# Used by codex-bg-watchdog.mjs to recognise the start-failure dialog
# ("ChatGPT failed to start." = Win32 class #32770 owned by the main process).
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as GBK.
param([int]$MaxWindows = 400)
$ErrorActionPreference = "SilentlyContinue"

Add-Type -Namespace CodexBgWin -Name U -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
public delegate bool EnumWindowsProc(IntPtr h, IntPtr lp);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
"@

$procs = @(Get-Process ChatGPT -ErrorAction SilentlyContinue)
$want = @{}
foreach ($p in $procs) { $want[[uint32]$p.Id] = $true }

$rows = New-Object System.Collections.ArrayList
$cb = [CodexBgWin.U+EnumWindowsProc]{
  param([IntPtr]$h, [IntPtr]$lp)
  $owner = [uint32]0
  [void][CodexBgWin.U]::GetWindowThreadProcessId($h, [ref]$owner)
  if ($want.ContainsKey($owner) -and $rows.Count -lt $MaxWindows) {
    $cb1 = New-Object System.Text.StringBuilder 256
    [void][CodexBgWin.U]::GetClassName($h, $cb1, 256)
    $tb1 = New-Object System.Text.StringBuilder 256
    [void][CodexBgWin.U]::GetWindowText($h, $tb1, 256)
    [void]$rows.Add([pscustomobject]@{
      cls   = $cb1.ToString()
      title = $tb1.ToString()
      vis   = [bool][CodexBgWin.U]::IsWindowVisible($h)
      min   = [bool][CodexBgWin.U]::IsIconic($h)
      proc  = [int]$owner
    })
  }
  return $true
}
[void][CodexBgWin.U]::EnumWindows($cb, [IntPtr]::Zero)

$vis = @($rows | Where-Object { $_.vis })
$dlg = @($rows | Where-Object { $_.cls -eq '#32770' })
[pscustomobject]@{
  procs   = $procs.Count
  windows = @($rows).Count
  visible = $vis.Count
  dialog  = ($dlg.Count -gt 0)
  dialogs = @($dlg | ForEach-Object { $_.title })
  classes = @($vis | ForEach-Object { $_.cls })
} | ConvertTo-Json -Compress
