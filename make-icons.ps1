$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path "assets\gen\sentinel-v1.png"))
$iconDir = "gui\src-tauri\icons"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

function Resize-Save($bmp, $size, $path) {
  $r = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($r)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($bmp, 0, 0, $size, $size)
  $r.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $r.Dispose()
  Write-Host "  $path ($size x $size)"
}

Write-Host "Generating PNG icons:"
Resize-Save $src 32  "$iconDir\32x32.png"
Resize-Save $src 128 "$iconDir\128x128.png"
Resize-Save $src 256 "$iconDir\128x128@2x.png"
Resize-Save $src 512 "$iconDir\icon.png"

# Also drop a square PNG in gui/public for the web topbar/rail
$pub = "gui\public"; New-Item -ItemType Directory -Force -Path $pub | Out-Null
Resize-Save $src 256 "$pub\logo.png"

# ---- Multi-size .ico (16,32,48,64,128,256) ----
function Build-Ico($bmp, $path, $sizes) {
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $entryCount = $sizes.Count
  $bw.Write([UInt16]0)                  # reserved
  $bw.Write([UInt16]1)                  # type ICO
  $bw.Write([UInt16]$entryCount)        # count
  $dirSize = 6 + 16*$entryCount
  $imageBlobs = @()
  $idx = 0
  foreach ($s in $sizes) {
    $tmp = New-Object System.IO.MemoryStream
    $r = New-Object System.Drawing.Bitmap $s, $s
    $g = [System.Drawing.Graphics]::FromImage($r)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($bmp, 0, 0, $s, $s)
    $r.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $r.Dispose()
    $bytes = $tmp.ToArray(); $tmp.Dispose()
    $imageBlobs += ,($bytes)
    $wbyte = if($s -ge 256){[byte]0}else{[byte]$s}
    $bw.Write([byte]$wbyte)             # width
    $bw.Write([byte]$wbyte)             # height
    $bw.Write([byte]0)                  # color count
    $bw.Write([byte]0)                  # reserved
    $bw.Write([UInt16]1)                # planes
    $bw.Write([UInt16]32)               # bpp
    $bw.Write([UInt32]$bytes.Length)    # size
    $bw.Write([UInt32]($dirSize))       # offset placeholder (will be fixed)
    $idx++
  }
  # compute real offsets
  $offset = $dirSize
  foreach ($blob in $imageBlobs) {
    # patch offset for this entry (already written as dirSize placeholder - recompute)
    $offset += 0
  }
  # simpler: rewrite offsets correctly
  $ms2 = New-Object System.IO.MemoryStream
  $bw2 = New-Object System.IO.BinaryWriter $ms2
  $bw2.Write([UInt16]0); $bw2.Write([UInt16]1); $bw2.Write([UInt16]$entryCount)
  $offset = 6 + 16*$entryCount
  for ($k=0; $k -lt $entryCount; $k++) {
    $s = $sizes[$k]; $blob = $imageBlobs[$k]
    $wbyte = if($s -ge 256){[byte]0}else{[byte]$s}
    $bw2.Write([byte]$wbyte); $bw2.Write([byte]$wbyte)
    $bw2.Write([byte]0); $bw2.Write([byte]0)
    $bw2.Write([UInt16]1); $bw2.Write([UInt16]32)
    $bw2.Write([UInt32]$blob.Length); $bw2.Write([UInt32]$offset)
    $offset += $blob.Length
  }
  foreach ($blob in $imageBlobs) { $bw2.Write($blob) }
  [System.IO.File]::WriteAllBytes((Resolve-Path ".").Path + "\$path", $ms2.ToArray())
  $bw2.Dispose(); $ms2.Dispose(); $bw.Dispose(); $ms.Dispose()
  Write-Host "  $path (ICO: $($sizes -join ','))"
}

Write-Host "Generating ICO:"
Build-Ico $src "$iconDir\icon.ico" @(16,32,48,64,128,256)

$src.Dispose()
Write-Host "DONE"
