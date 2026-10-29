$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$expr = Join-Path $PSScriptRoot "smoke-expr.js"
$cdp = Join-Path $PSScriptRoot "cdp.js"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "smoke: node not found in PATH" }
if (-not (Test-Path $expr)) { throw "smoke: missing $expr" }

Push-Location $root
try {
    $raw = & node $cdp evalfile $expr 2>&1 | Out-String
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Host $raw.Trim()
        throw "smoke: CDP call failed. Start Spotify with --remote-debugging-port=9222 and install the extension."
    }
    $r = $raw | ConvertFrom-Json
    if (-not $r.ok) {
        Write-Host ($r.problems -join "`n")
        throw "smoke: extension is not healthy"
    }
    "ok        : yes"
    "marker    : $($r.marker)"
    "state     : mode=$($r.state.mode) anim=$($r.state.anim) frame=$($r.state.frame) sleeping=$($r.state.sleeping)"
    "position  : x=$([math]::Round($r.state.pos.x)) y=$([math]::Round($r.state.pos.y)) size=$($r.state.size.width)x$($r.state.size.height)"
    "catalog   : $($r.state.frames) frames / $($r.state.animations) animations"
    "variant   : $($r.state.settings.variant) scale=$($r.state.settings.scale) speed=$($r.state.settings.speed)"
    "background: $($r.background)"
} finally {
    Pop-Location
}
