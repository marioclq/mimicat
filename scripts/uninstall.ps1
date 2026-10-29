$ErrorActionPreference = "Stop"
$spice = Join-Path $env:APPDATA "spicetify"
$file = Join-Path $spice "Extensions\vfdPet.js"
$backup = Join-Path $spice "vfdpet-backup.json"

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) { throw "uninstall: spicetify not found in PATH" }

function Get-Cfg([string]$key) { (spicetify config $key | Out-String).Trim() }

function Set-IniValue([string]$key, [string]$value) {
    $ini = Join-Path $spice "config-xpui.ini"
    if (-not (Test-Path $ini)) { throw "uninstall: missing $ini" }
    $text = [IO.File]::ReadAllText($ini)
    $pattern = "(?m)^($key\s*=)[^\r\n]*"
    if ($text -notmatch $pattern) { throw "uninstall: key '$key' not found in $ini" }
    $new = [regex]::Replace($text, $pattern, { param($m) "$($m.Groups[1].Value) $value" })
    [IO.File]::WriteAllText($ini, $new, [Text.UTF8Encoding]::new($false))
}

$saved = if (Test-Path $backup) { Get-Content $backup -Raw | ConvertFrom-Json } else { $null }
$changed = $false

$ext = Get-Cfg extensions
if ($ext -match "(^|\|)vfdPet\.js(\||$)") {
    spicetify config extensions vfdPet.js-
    $changed = $true
    Write-Host "Removed vfdPet.js from extensions."
}
if (Test-Path $file) {
    Remove-Item -Force $file
    $changed = $true
    Write-Host "Deleted $file"
}

# Only touch the flag if it is still exactly what install.ps1 set.
if ($saved -and $saved.debugPort -and (Get-Cfg spotify_launch_flags) -eq "--remote-debugging-port=9222") {
    Set-IniValue spotify_launch_flags ([string]$saved.spotify_launch_flags)
    $changed = $true
    Write-Host "Restored spotify_launch_flags."
}

if (Test-Path $backup) { Remove-Item -Force $backup }

if (-not $changed) {
    Write-Host "vfdPet is not installed; nothing to do."
    exit 0
}

Write-Host "Applying (Spotify will restart)..."
spicetify apply
Write-Host "Done. extensions = $(Get-Cfg extensions)"
