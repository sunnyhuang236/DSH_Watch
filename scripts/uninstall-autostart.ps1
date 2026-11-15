# 移除当前用户的 M2 登录启动项。
$startup = [Environment]::GetFolderPath('Startup')
$vbsPath = Join-Path $startup 'DSH-Watch-M2.vbs'
if (Test-Path $vbsPath) { Remove-Item $vbsPath -Force; Write-Host "已移除: $vbsPath" } else { Write-Host '未找到启动项' }
