# ============================================================================
#  无损还原实验 — 你自己跑一遍看看
#  用法：双击本文件（或在 PowerShell 里执行）
#  它会：造一个 24 MB 的难缠测试文件 → 按 5 MB 切开 → 重组 → 逐字节比对
# ============================================================================
$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "att-tools\dist"
if (-not (Test-Path (Join-Path $exe "att-split.exe"))) {
  $exe = "C:\Users\qing1\Desktop\审查版\att-tools\dist"
}
$work = Join-Path $env:TEMP ("att-experiment-" + (Get-Date -Format "HHmmss"))
New-Item -ItemType Directory -Path $work | Out-Null

Write-Host "`n[1/4] 造测试文件（24 MB 随机二进制，模拟真实的表格附件）" -ForegroundColor Cyan
$rnd = New-Object byte[] (24MB)
(New-Object Random 20260913).NextBytes($rnd)
$src = Join-Path $work "原始附件_季度报价单.bin"
[System.IO.File]::WriteAllBytes($src, $rnd)
$before = (Get-FileHash $src -Algorithm SHA256).Hash
Write-Host "      切前 SHA-256  $before"

Write-Host "`n[2/4] 按 5 MB 切开（模拟 20 MB 的上限）" -ForegroundColor Cyan
& (Join-Path $exe "att-split.exe") $src --limit 5MB | Out-Null
$parts = (Get-ChildItem $work -Filter "*att-part-*").Count
Write-Host "      产出分片 $parts 个，外加清单与三个重组脚本"

Write-Host "`n[3/4] 重组（模拟收件人双击 .cmd，原件不在场）" -ForegroundColor Cyan
$clean = Join-Path $work "recipient"
New-Item -ItemType Directory $clean | Out-Null
Get-ChildItem $work -Filter "*att-*" | Copy-Item -Destination $clean
Push-Location $clean
& cmd.exe /c "原始附件_季度报价单.bin.att-reassemble.cmd" | Out-Null
Pop-Location
$out = Join-Path $clean "原始附件_季度报价单.bin"

Write-Host "`n[4/4] 逐字节比对" -ForegroundColor Cyan
if (-not (Test-Path $out)) { Write-Host "      重组失败" -ForegroundColor Red; exit 1 }
$after = (Get-FileHash $out -Algorithm SHA256).Hash
$a = [System.IO.File]::ReadAllBytes($src); $b = [System.IO.File]::ReadAllBytes($out)
$diff = 0
if ($a.Length -eq $b.Length) { for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { $diff++ } } } else { $diff = -1 }
Write-Host "      重组后 SHA-256  $after"
Write-Host "      字节数  $($a.Length) vs $($b.Length)"
Write-Host "      不同字节  $diff"
if ($before -eq $after -and $diff -eq 0) {
  Write-Host "`n  [通过] 无损还原成立：SHA-256 完全相同，逐字节零差异。`n" -ForegroundColor Green
} else {
  Write-Host "`n  [失败] 存在差异，请把上面的数字发我。`n" -ForegroundColor Red
}
Write-Host "  实验目录（可自行查看分片与清单）：$work`n" -ForegroundColor DarkGray
Read-Host "按回车关闭"
