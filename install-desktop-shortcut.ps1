# install-desktop-shortcut.ps1 —— 在桌面创建"DeepSeek Harness"快捷方式（大鲸鱼图标）
#
# 目标为工作区里的启动入口 .cmd（内部转 launch-dsh.ps1）；图标用本仓库生成的
# 官方鲸鱼 .ico（多尺寸 16/32/48/64/128/256）。幂等：重复运行会覆盖同名快捷方式。
$ErrorActionPreference = 'Stop'

$ws = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ws)) { $ws = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$cmd = Join-Path $ws '启动 DeepSeek Harness.cmd'
$ico = Join-Path $ws 'assets\deepseek-whale.ico'

if (-not (Test-Path $cmd)) { throw "启动入口不存在: $cmd" }
if (-not (Test-Path $ico)) { throw "图标不存在: $ico" }

$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop)) { throw '无法定位桌面目录' }
$lnk = Join-Path $desktop 'DeepSeek Harness.lnk'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $cmd
$sc.WorkingDirectory = $ws
$sc.IconLocation = "$ico,0"
$sc.Description = 'DeepSeek Harness —— 启动/打开本地 DSH'
$sc.WindowStyle = 7   # 最小化启动，避免控制台窗口挡屏
$sc.Save()

$check = $shell.CreateShortcut($lnk)
Write-Output "快捷方式: $lnk"
Write-Output ("  Target : " + $check.TargetPath)
Write-Output ("  WorkDir: " + $check.WorkingDirectory)
Write-Output ("  Icon   : " + $check.IconLocation)
Write-Output ("  Exists : " + (Test-Path $lnk))
