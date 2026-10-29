param([switch]$NoApply, [switch]$DebugPort)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$spice = Join-Path $env:APPDATA "spicetify"
$extDir = Join-Path $spice "Extensions"
$src = Join-Path $root "Extensions\vfdPet.js"
$backup = Join-Path $spice "vfdpet-backup.json"

if (-not (Get-Command spicetify -ErrorAction SilentlyContinue)) { throw "install: spicetify not found in PATH" }
if (-not (Test-Path $src)) { throw "install: missing $src; run node tools\build.js first" }

function Get-Cfg([string]$key) { (spicetify config $key | Out-String).Trim() }

# `spicetify config spotify_launch_flags --x=y` is ignored because the value
# looks like a CLI flag, so this one key is written into config-xpui.ini.
function Set-IniValue([string]$key, [string]$value) {
    $ini = Join-Path $spice "config-xpui.ini"
    if (-not (Test-Path $ini)) { throw "install: missing $ini" }
    $text = [IO.File]::ReadAllText($ini)
    $pattern = "(?m)^($key\s*=)[^\r\n]*"
    if ($text -notmatch $pattern) { throw "install: key '$key' not found in $ini" }
    $new = [regex]::Replace($text, $pattern, { param($m) "$($m.Groups[1].Value) $value" })
    [IO.File]::WriteAllText($ini, $new, [Text.UTF8Encoding]::new($false))
}

# Remember the extension list once. Uninstall only removes vfdPet.js, so later
# extensions are never clobbered.
if (-not (Test-Path $backup)) {
    [ordered]@{
        extensions           = Get-Cfg extensions
        spotify_launch_flags = Get-Cfg spotify_launch_flags
        debugPort            = [bool]$DebugPort
    } | ConvertTo-Json | Set-Content $backup -Encoding utf8
    Write-Host "Backup written: $backup"
}

New-Item -ItemType Directory -Force $extDir | Out-Null
Copy-Item -Force $src $extDir

$ext = Get-Cfg extensions
if ($ext -notmatch "(^|\|)vfdPet\.js(\||$)") {
    if ([string]::IsNullOrWhiteSpace($ext)) { spicetify config extensions vfdPet.js }
    else { spicetify config extensions "$ext|vfdPet.js" }
}

if ($DebugPort) {
    Set-IniValue spotify_launch_flags "--remote-debugging-port=9222"
    Write-Host "Debug port enabled: Spotify will listen on 127.0.0.1:9222."
}

Write-Host "Copied: $src -> $extDir"
Write-Host "extensions = $(Get-Cfg extensions)"
if ($NoApply) {
    Write-Host "Not applied. Run 'spicetify apply' when you are ready (it restarts Spotify)."
    exit 0
}
Write-Host "Applying (Spotify will restart)..."
spicetify apply
Write-Host "Done. Right-click the cat for actions; type 'michi' for settings."
