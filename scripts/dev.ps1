param([switch]$Apply)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$spice = Join-Path $env:APPDATA "spicetify"
$dest = Join-Path $spice "Extensions\vfdPet.js"

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) { throw "dev: spicetify not found in PATH" }

Push-Location $root
try {
    node tools\build.js
    if ($LASTEXITCODE -ne 0) { throw "dev: build failed" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
Copy-Item -Force (Join-Path $root "Extensions\vfdPet.js") $dest
Write-Host "Copied to $dest"

$ext = (spicetify config extensions | Out-String).Trim()
if ($ext -notmatch "(^|\|)vfdPet\.js(\||$)") {
    Write-Host "Warning: vfdPet.js is not enabled in Spicetify. Run scripts\install.ps1 once."
}

if ($Apply) {
    Write-Host "Applying (Spotify will restart)..."
    spicetify apply
} else {
    Write-Host "Reload the client with Ctrl+R, or run scripts\dev.ps1 -Apply to restart Spotify."
}
