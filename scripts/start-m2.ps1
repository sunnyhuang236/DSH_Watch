# 兼容旧入口：转发到 start-m2.cmd（隐藏窗口）。
$scriptPath = $MyInvocation.MyCommand.Path
if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Definition }
$cmd = Join-Path (Split-Path -Parent $scriptPath) 'start-m2.cmd'
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmd) -WindowStyle Hidden
