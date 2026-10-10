param([switch]$Background)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$daylightNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $daylightNode) {
    $daylightBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $daylightBundledNode) { $daylightNodePath = $daylightBundledNode }
    else { throw 'Node.js 24 or newer is required. Install Node.js and run this script again.' }
} else { $daylightNodePath = $daylightNode.Source }
if ($Background) {
    try {
        $daylightStatus = Invoke-RestMethod 'http://127.0.0.1:4318/api/status' -TimeoutSec 3
        if ($daylightStatus.city -eq 'Stockholm') { Write-Host 'Daylight is already running at http://127.0.0.1:4318/#live'; exit 0 }
        throw 'Another application is using port 4318.'
    } catch {
        if (Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4318 is occupied. No process was stopped.' }
    }
    $daylightProcess = Start-Process -FilePath $daylightNodePath -ArgumentList '--env-file-if-exists=.env','server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server-error.log') -PassThru
    for ($daylightAttempt = 0; $daylightAttempt -lt 10; $daylightAttempt++) {
        Start-Sleep -Milliseconds 500
        $daylightProcess.Refresh()
        if ($daylightProcess.HasExited) { throw 'Daylight failed to start. Check server-error.log.' }
        try { $daylightStatus = Invoke-RestMethod 'http://127.0.0.1:4318/api/status' -TimeoutSec 2 } catch { continue }
        if ($daylightStatus.city -eq 'Stockholm') {
            @{ pid = $daylightProcess.Id; started = $daylightProcess.StartTime.ToUniversalTime().Ticks } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'data/service-process.json')
            Write-Host "Daylight ready at http://127.0.0.1:4318/#live (PID $($daylightProcess.Id))"
            exit 0
        }
    }
    throw 'Daylight did not become ready. Check server-error.log.'
} else {
    & $daylightNodePath --env-file-if-exists=.env server.mjs
}
