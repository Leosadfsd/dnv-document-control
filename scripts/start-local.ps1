$ErrorActionPreference = 'Stop'
$toolDir = Split-Path -Parent $PSScriptRoot
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeExe = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath (Join-Path $toolDir 'dist\index.html'))) { throw 'Build the application first: pnpm build' }
try { $active = Invoke-WebRequest -Uri 'http://127.0.0.1:4187/' -TimeoutSec 2 -UseBasicParsing } catch { $active = $null }
if ($active -and $active.Content -notmatch 'DNV') { throw 'Port 4187 belongs to another application.' }
if (-not $active) {
  $serverScript = Join-Path $PSScriptRoot 'serve-local.mjs'
  Start-Process -FilePath $nodeExe -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $toolDir -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    try { $active = Invoke-WebRequest -Uri 'http://127.0.0.1:4187/' -TimeoutSec 1 -UseBasicParsing; break } catch {}
  }
  if (-not $active) { throw 'Local server did not start. Check port 4187.' }
}
Start-Process 'http://127.0.0.1:4187/'
