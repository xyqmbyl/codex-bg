# Compare two PNG screenshots: per-pixel diff count + colour variety inside a region.
# Usage: powershell -File _pixdiff.ps1 a.png b.png
param([string]$A, [string]$B)
Add-Type -AssemblyName System.Drawing
$ia = [System.Drawing.Bitmap]::FromFile((Resolve-Path $A))
$ib = [System.Drawing.Bitmap]::FromFile((Resolve-Path $B))
Write-Output ("sizeA=" + $ia.Width + "x" + $ia.Height + " sizeB=" + $ib.Width + "x" + $ib.Height)
$step = 4
$diff = 0
$tot = 0
$colors = @{}
$diffBox = @{minx=99999;miny=99999;maxx=-1;maxy=-1}
for ($y = 0; $y -lt $ia.Height; $y += $step) {
  for ($x = 0; $x -lt $ia.Width; $x += $step) {
    $pa = $ia.GetPixel($x, $y)
    $pb = $ib.GetPixel($x, $y)
    $tot++
    $key = "$($pa.R),$($pa.G),$($pa.B)"
    $colors[$key] = 1
    $d = [Math]::Abs($pa.R - $pb.R) + [Math]::Abs($pa.G - $pb.G) + [Math]::Abs($pa.B - $pb.B)
    if ($d -gt 12) {
      $diff++
      if ($x -lt $diffBox.minx) { $diffBox.minx = $x }
      if ($y -lt $diffBox.miny) { $diffBox.miny = $y }
      if ($x -gt $diffBox.maxx) { $diffBox.maxx = $x }
      if ($y -gt $diffBox.maxy) { $diffBox.maxy = $y }
    }
  }
}
Write-Output ("sampled=$tot differing=$diff ratio=" + [Math]::Round(100.0 * $diff / $tot, 2) + "% distinctColours=" + $colors.Count)
Write-Output ("diffBBox=" + $diffBox.minx + "," + $diffBox.miny + " - " + $diffBox.maxx + "," + $diffBox.maxy)
# left strip (wallpaper usually visible left of / behind content) colour variety
$lc = @{}
for ($y = 0; $y -lt $ia.Height; $y += 6) { for ($x = 0; $x -lt 400; $x += 6) { $p = $ia.GetPixel($x, $y); $lc["$($p.R),$($p.G),$($p.B)"] = 1 } }
Write-Output ("leftStripDistinctColours=" + $lc.Count)
$ia.Dispose(); $ib.Dispose()
