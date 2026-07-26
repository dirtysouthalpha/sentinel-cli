$or = $env:OPENROUTER_API_KEY
$body = @{
  model = "google/gemini-2.5-flash-image"
  messages = @(@{ role="user"; content="Generate a small glowing cyan circle on a pure black background as an app icon." })
  modalities = @("image")
} | ConvertTo-Json -Depth 8
try {
  $r = Invoke-WebRequest -Uri "https://openrouter.ai/api/v1/chat/completions" -Method POST -Body $body -ContentType "application/json" -Headers @{Authorization="Bearer $or"; "HTTP-Referer"="https://sentinel.cli"} -TimeoutSec 120 -UseBasicParsing
  Write-Host "OK $($r.StatusCode)"
  $j = $r.Content | ConvertFrom-Json
  if ($j.choices[0].message.images) { Write-Host ("IMAGE(s): " + $j.choices[0].message.images.Count) }
  elseif ($j.choices[0].message.content) { Write-Host "CONTENT-TYPE: text" }
  $j.choices[0].message | ConvertTo-Json -Depth 6 | Select-Object -First 40
  Write-Host "---usage---"; $j.usage | ConvertTo-Json -Compress
} catch {
  $resp=$_.Exception.Response
  if($resp){ $sr=New-Object System.IO.StreamReader($resp.GetResponseStream()); Write-Host ("$([int]$resp.StatusCode): " + $sr.ReadToEnd()) } else { Write-Host $_.Exception.Message }
}
