# _shot-codex.ps1 - PrintWindow-render the visible Codex window (works even when occluded).
# ASCII only (PS 5.1 reads BOM-less files as GBK).
param([string]$Out = "$env:TEMP\codex-window.png")

$ErrorActionPreference = "Continue"
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W8 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

$pids = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($pids.Count -eq 0) { Write-Output "no ChatGPT.exe running"; exit 1 }

$best = $null
$cb = [W8+EnumProc]{
  param($h, $p)
  $pid2 = 0
  [void][W8]::GetWindowThreadProcessId($h, [ref]$pid2)
  if ($pids -contains [int]$pid2) {
    if ([W8]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 256
      [void][W8]::GetClassName($h, $sb, 256)
      $cls = $sb.ToString()
      $r = New-Object W8+RECT
      [void][W8]::GetWindowRect($h, [ref]$r)
      $w = $r.R - $r.L; $ht = $r.B - $r.T
      if ($cls -like "Chrome_WidgetWin_1*" -and $w -gt 200 -and $ht -gt 200) {
        $script:best = [pscustomobject]@{ Hwnd = $h; Cls = $cls; X = $r.L; Y = $r.T; W = $w; H = $ht }
        return $false
      }
    }
  }
  return $true
}
[void][W8]::EnumWindows($cb, [IntPtr]::Zero)

if (-not $best) { Write-Output "no visible Chrome_WidgetWin_1 window for ChatGPT"; exit 1 }
Write-Output ("window hwnd={0} class={1} rect={2},{3} {4}x{5}" -f $best.Hwnd, $best.Cls, $best.X, $best.Y, $best.W, $best.H)

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::new([int]$best.W, [int]$best.H)
$g = [System.Drawing.Graphics]::FromImage($img)
$hdc = $g.GetHdc()
$ok = [W8]::PrintWindow([IntPtr]$best.Hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$img.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
Write-Output ("PrintWindow ok={0} saved={1}" -f $ok, $Out)
