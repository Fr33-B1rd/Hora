$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv-voice/Scripts/python.exe')) {
    python -m venv .venv-voice
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
& '.venv-voice/Scripts/python.exe' -m pip install -r voice-requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Speech dependencies installation failed.' }
& '.venv-voice/Scripts/python.exe' -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-small', local_dir='models/whisper-small', allow_patterns=['config.json','model.bin','tokenizer.json','vocabulary.txt'])"
if ($LASTEXITCODE -ne 0) { throw 'Speech model download failed.' }
Write-Host 'Local speech installed. Restart Daylight, then reload the page.'
