$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
try {
    $env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new(
        '', (Read-Host 'Gemini API key' -AsSecureString)
    ).Password
    node .\scripts\build.cjs
    if ($LASTEXITCODE -ne 0) { throw 'The frontend could not be prepared.' }
    Write-Host 'Open http://127.0.0.1:7860/ after the server is ready. Keep this window open.'
    py .\voice_server.py
} finally {
    Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
}
