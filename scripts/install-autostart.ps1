# 把 M2 网关加入当前用户登录启动（无需管理员）。卸载见 uninstall-autostart.ps1。
$scriptPath = $MyInvocation.MyCommand.Path
if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $scriptPath)
$startup = [Environment]::GetFolderPath('Startup')
$vbsPath = Join-Path $startup 'DSH-Watch-M2.vbs'
$script = Join-Path $repo 'scripts\start-m2.cmd'
$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd.exe /c ""$script""", 0, False
"@
Set-Content -Path $vbsPath -Value $vbs -Encoding Unicode
Write-Host "已安装开机启动: $vbsPath"
