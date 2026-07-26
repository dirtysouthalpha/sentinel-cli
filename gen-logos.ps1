$ErrorActionPreference = "Stop"
$or = $env:OPENROUTER_API_KEY
$out = "assets\gen"
New-Item -ItemType Directory -Force -Path $out | Out-Null

# ONE premium concept - best bang for buck. Classic Tron guardian-eye, iconic & symmetrical.
$prompt = @'
You are a world-class brand designer creating a premium app icon for "Sentinel CLI", a cyberpunk/Tron-style terminal AI coding assistant. Generate ONE self-contained emblem centered on a pure-black background, filling a square.

THE DESIGN (precise):
- A geometric HEXAGON frame with sharp clean edges, drawn as a glowing neon-cyan (#00D4FF) tube outline with a subtle metallic chrome bevel giving premium depth.
- Inside the hexagon, centered: a stylized GUARDIAN EYE / watching sentinel lens. An almond/lens eye shape with a bright glowing cyan IRIS (a luminous disc) and a thin vertical light-beam scanning line passing straight down through the pupil like a scanner beam.
- One single hot-magenta (#FF2E63) accent node at the top vertex of the hexagon only - everything else is cyan.
- Volumetric neon glow around the cyan elements. Recessed dark eye socket behind the iris. Faint horizontal scanlines across the icon. A faint perspective Tron grid floor receding into darkness at the very bottom.
- Deep near-black background (#02040A) with a subtle blue radial vignette.

MOOD: iconic, balanced, symmetrical, cinematic, Apple-grade polish. Classic Tron neon tube glow. The image must read clearly even when tiny.

ABSOLUTELY NO text, words, letters, numbers, or watermarks anywhere. Pure emblem only.
'@

function Call-Nano($text, $jsonOut) {
  $body = @{ model="google/gemini-2.5-flash-image"; messages=@(@{role="user";content=$text}); modalities=@("image") } | ConvertTo-Json -Depth 8
  for ($t=1; $t -le 5; $t++) {
    try {
      $r = Invoke-WebRequest -Uri "https://openrouter.ai/api/v1/chat/completions" -Method POST -Body $body -ContentType "application/json" -Headers @{Authorization="Bearer $or"; "HTTP-Referer"="https://sentinel.cli"} -TimeoutSec 180 -UseBasicParsing
      $r.Content | Out-File -FilePath $jsonOut -Encoding utf8
      return $true
    } catch {
      $resp = $_.Exception.Response
      $code = if($resp){[int]$resp.StatusCode}else{0}
      Write-Host "    try$t err $code"
      if($code -eq 429 -or $code -eq 502 -or $code -eq 503 -or $code -eq 0){ Start-Sleep -Seconds ($t*10) } else { return $false }
    }
  }
  return $false
}

$jsonOut = "$out\sentinel-v1.json"; $pngOut = "$out\sentinel-v1.png"
Write-Host "Generating premium guardian-eye concept..."
$ok = Call-Nano $prompt $jsonOut
if (-not $ok) { Write-Host "FAILED"; exit 1 }
$j = Get-Content $jsonOut -Raw | ConvertFrom-Json
$img = $j.choices[0].message.images[0].image_url.url
$b64 = $img -replace "^data:image/png;base64,",""
[void][System.Reflection.Assembly]::LoadWithPartialName("System.IO")
[System.IO.File]::WriteAllBytes((Resolve-Path ".").Path + "\$pngOut", [System.Convert]::FromBase64String($b64))
Write-Host "saved $pngOut ($((Get-Item $pngOut).Length) bytes) cost=$($j.usage.cost)"
Write-Host "DONE"
