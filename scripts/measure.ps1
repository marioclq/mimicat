param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$budget = 300 * 1024
$files = @(
    "Extensions\vfdPet.js",
    "src\vfdPet.js",
    "assets\pet\spritesheet.png",
    "assets\pet\animations.json",
    "assets\pet\contact-sheet.png",
    "assets\preview\preview.png",
    "assets\preview\preview.gif"
)
$total = 0
foreach ($f in $files) {
    $path = Join-Path $Root $f
    if (-not (Test-Path $path)) { throw "measure: missing file $path" }
    $len = (Get-Item $path).Length
    $total += $len
    "{0,9} B  {1}" -f $len, $f
}
"{0,9} B  TOTAL (all listed files)" -f $total

$ext = (Get-Item (Join-Path $Root "Extensions\vfdPet.js")).Length
$pct = [math]::Round(100 * $ext / $budget, 1)
"{0,9} B  extension budget" -f $budget
"extension uses $pct% of the 300 KiB budget"
if ($ext -gt $budget) { throw "measure: extension is over budget ($ext > $budget)" }
