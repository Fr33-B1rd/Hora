$ErrorActionPreference = 'Stop'
$daylightRecordPath = Join-Path $PSScriptRoot 'data/service-process.json'
if (-not (Test-Path -LiteralPath $daylightRecordPath)) { Write-Host 'No managed Daylight process found.'; exit 0 }
$daylightRecord = Get-Content -LiteralPath $daylightRecordPath -Raw | ConvertFrom-Json
$daylightProcess = Get-Process -Id $daylightRecord.pid -ErrorAction SilentlyContinue
if (-not $daylightProcess) { Write-Host 'Daylight is already stopped.'; exit 0 }
if ($daylightProcess.ProcessName -ne 'node' -or $daylightProcess.StartTime.ToUniversalTime().Ticks -ne $daylightRecord.started) { throw 'Process identity changed. Nothing was stopped.' }
Stop-Process -Id $daylightProcess.Id
Write-Host 'Daylight stopped. Saved calendar events and settings are retained.'
