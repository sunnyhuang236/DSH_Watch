[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot

function Step($text) { Write-Host ""; Write-Host "== $text ==" -ForegroundColor Cyan }
function Fail($text) { Write-Host "错误：$text" -ForegroundColor Red; exit 1 }

function Find-Dsh {
  $cmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $candidates = @(
    (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    (Join-Path $env:USERPROFILE 'AppData\Local\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
    'D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd',
    'C:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
  )
  foreach ($path in $candidates) { if ($path -and (Test-Path -LiteralPath $path)) { return $path } }
  return $null
}

Write-Host 'DSH Watch 安装检查' -ForegroundColor Green
Write-Host "项目目录：$repo"

Step '1/4 检查 Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail '未找到 Node.js。请先安装 Node.js 24 LTS：https://nodejs.org/' }
Write-Host ("Node: " + (& node --version))
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Fail '未找到 npm，请重新安装 Node.js LTS。' }

Step '2/4 检查 DSH'
$dsh = Find-Dsh
if (-not $dsh) { Fail '未找到 DSH Desktop。请先安装并启动 DSH Desktop 一次，再运行本安装脚本。' }
Write-Host ("DSH: " + $dsh)

if ($CheckOnly) {
  Write-Host ''
  Write-Host '检查通过（未安装任何东西）。' -ForegroundColor Green
  exit 0
}

Step '3/4 安装网关依赖并运行测试'
Set-Location -LiteralPath $repo
if (-not (Test-Path -LiteralPath (Join-Path $repo 'packages\gateway\node_modules\web-push'))) {
  Write-Host '首次安装 gateway 依赖…'
  & $npm install --prefix (Join-Path $repo 'packages\gateway')
  if ($LASTEXITCODE -ne 0) { Fail '网关依赖安装失败，请检查网络后重试。' }
}
& $npm test
if ($LASTEXITCODE -ne 0) { Fail '测试未通过，已停止安装。' }

Step '4/4 安装 dsh-watch 插件'
$profilePath = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
if (-not (Test-Path -LiteralPath $profilePath)) {
  Fail "找不到 DSH profile '$Profile'。请先启动 DSH Desktop 一次；如果使用 Web 版，请把脚本参数改为 -Profile web。"
}
& $dsh plugin --profile $Profile add ("file:" + (Join-Path $repo 'packages\dsh-watch'))
if ($LASTEXITCODE -ne 0) { Fail 'dsh-watch 插件安装失败。' }

Write-Host ''
Write-Host '安装完成。' -ForegroundColor Green
Write-Host '下一步：'
Write-Host '  1. 重启 DSH Desktop；'
Write-Host '  2. 双击 start-dsh-watch.cmd，按提示配对手机。'