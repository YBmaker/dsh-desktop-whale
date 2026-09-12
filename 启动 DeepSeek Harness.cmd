@echo off
rem DeepSeek Harness 桌面启动入口（双击即可）
rem 真正的逻辑在 launch-dsh.ps1；这里只负责用 PowerShell 拉起它。
chcp 65001 >nul
setlocal
set "HERE=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%HERE%launch-dsh.ps1"
endlocal
