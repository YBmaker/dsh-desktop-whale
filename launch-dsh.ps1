# launch-dsh.ps1 —— DeepSeek Harness 桌面启动入口的真正逻辑
#
# 修复记录（v2）：
#   * 旧版用 `Get-Command dsh` 找启动命令 —— 但用户的持久 PATH 里没有 dsh
#     （用户 PATH 只有 Python / WindowsApps / %APPDATA%\npm），双击必定失败。
#     现在改为：配置记忆 → DSH_RUNTIME_DIR → PATH → pnpm store（最新）→ dlx → npm 全局。
#   * 旧版用 `Invoke-WebRequest http://127.0.0.1:3080` 判断"是否在运行"，而首页返回 401
#     会让它抛异常、被判成"没在跑"。现在改用 TCP 连接判断，与鉴权无关。
#   * 失败不再在最小化窗口里 Read-Host（用户看不到），改为弹出可见提示框。
#
# 配置：同目录 launch-config.json
#   { "port": 3080, "openMode": "browser", "runtimeDir": "...", "nodePath": "...", "workdir": "..." }
#   openMode: browser（默认，打开网站）| desktop（只拉起桌面窗口）| both
#   workdir : 启动 dsh web 时的工作目录（留空 = 用户主目录）
#
# 参数：
#   -DiscoverOnly   只做"发现 dsh 运行时并写入 launch-config.json"，不启动任何进程
param([switch]$DiscoverOnly)

$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$logDir = Join-Path $here 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'dsh-web.log'
$serverOut = Join-Path $logDir 'dsh-web-server.log'
$serverErr = Join-Path $logDir 'dsh-web-server.err.log'
$configPath = Join-Path $here 'launch-config.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$message) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Write-Host $line
    try { Add-Content -Path $log -Value $line -Encoding UTF8 } catch { }
}

function Show-Notice([string]$text) {
    Write-Log "NOTICE: $text"
    try {
        $shell = New-Object -ComObject WScript.Shell
        # 0 = 无限等待；48 = 信息图标 + 置顶
        [void]$shell.Popup($text, 0, 'DeepSeek Harness', 48)
    } catch {
        Write-Host $text
        Start-Sleep -Seconds 15
    }
}

function Read-Config {
    $cfg = [ordered]@{ port = 3080; openMode = 'browser'; runtimeDir = ''; nodePath = ''; workdir = '' }
    if (Test-Path $configPath) {
        try {
            $raw = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
            foreach ($k in @($cfg.Keys)) {
                $v = $raw.$k
                if ($null -ne $v -and "$v" -ne '') { $cfg[$k] = $v }
            }
        } catch { Write-Log "配置解析失败，使用默认值：$($_.Exception.Message)" }
    }
    return $cfg
}

function Save-Config($cfg) {
    try {
        [System.IO.File]::WriteAllText($configPath, ($cfg | ConvertTo-Json -Depth 3), $utf8NoBom)
        Write-Log '已更新 launch-config.json'
    } catch { Write-Log "配置写入失败：$($_.Exception.Message)" }
}

function Test-TcpPort([int]$port, [int]$timeoutMs = 1500) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch { return $false } finally { try { $client.Close() } catch { } }
}

function Get-BinFromDir([string]$dir) {
    if ([string]::IsNullOrWhiteSpace($dir)) { return $null }
    foreach ($rel in @('node_modules\@deepseek-ai\dsh\lib\bin.js', 'lib\bin.js')) {
        $p = Join-Path $dir $rel
        if (Test-Path $p) { return $p }
    }
    return $null
}

# 由 bin.js 反推"可再次传入 Get-BinFromDir 的目录"。
#   <hashDir>\node_modules\@deepseek-ai\dsh\lib\bin.js  ->  <hashDir>
#   <pkgDir>\lib\bin.js                                 ->  <pkgDir>
function Get-RuntimeDirFromBin([string]$bin) {
    if ([string]::IsNullOrWhiteSpace($bin)) { return $null }
    $p = $bin -replace '\\lib\\bin\.js$', ''
    if ($p -eq $bin) { return $null }
    $q = $p -replace '\\node_modules\\@deepseek-ai\\dsh$', ''
    return $q
}

function Resolve-Runtime([string]$preferredDir) {
    $bin = Get-BinFromDir $preferredDir
    if ($bin) { return [ordered]@{ kind = 'node'; bin = $bin; source = 'launch-config.json' } }

    $bin = Get-BinFromDir $env:DSH_RUNTIME_DIR
    if ($bin) { return [ordered]@{ kind = 'node'; bin = $bin; source = 'DSH_RUNTIME_DIR' } }

    $cmd = Get-Command dsh -ErrorAction SilentlyContinue
    if ($cmd) { return [ordered]@{ kind = 'dsh'; cmd = $cmd.Source; source = 'PATH' } }

    $links = Join-Path $env:LOCALAPPDATA 'pnpm\store\v11\links\@deepseek-ai\dsh'
    if (Test-Path $links) {
        $cands = @()
        foreach ($verDir in (Get-ChildItem $links -Directory -ErrorAction SilentlyContinue)) {
            foreach ($hashDir in (Get-ChildItem $verDir.FullName -Directory -ErrorAction SilentlyContinue)) {
                $b = Get-BinFromDir $hashDir.FullName
                if ($b) {
                    $cands += [pscustomobject]@{ bin = $b; dir = $hashDir.FullName; ver = $verDir.Name; mtime = $hashDir.LastWriteTime }
                }
            }
        }
        $best = $cands | Sort-Object mtime -Descending | Select-Object -First 1
        if ($best) { return [ordered]@{ kind = 'node'; bin = $best.bin; source = "pnpm-store:$($best.ver)" } }
    }

    $dlx = Join-Path $env:LOCALAPPDATA 'pnpm-cache\dlx'
    if (Test-Path $dlx) {
        $hit = Get-ChildItem $dlx -Recurse -Filter 'dsh.CMD' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($hit) { return [ordered]@{ kind = 'dsh'; cmd = $hit.FullName; source = 'pnpm-dlx' } }
    }

    foreach ($p in @((Join-Path $env:APPDATA 'npm\dsh.cmd'), (Join-Path $env:APPDATA 'npm\dsh.ps1'))) {
        if (Test-Path $p) { return [ordered]@{ kind = 'dsh'; cmd = $p; source = 'npm-global' } }
    }
    return $null
}

function Resolve-Node([string]$preferred) {
    if (-not [string]::IsNullOrWhiteSpace($preferred) -and (Test-Path $preferred)) { return $preferred }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @(
            "$env:ProgramFiles\nodejs\node.exe",
            "${env:ProgramFiles(x86)}\nodejs\node.exe",
            "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
            "$env:APPDATA\npm\node.exe"
        )) {
        if (-not [string]::IsNullOrWhiteSpace($p) -and (Test-Path $p)) { return $p }
    }
    # 最后再问一次 where.exe（个别环境下 Get-Command 受执行策略限制）
    try {
        $w = & where.exe node 2>$null | Select-Object -First 1
        if ($w -and (Test-Path $w)) { return $w }
    } catch { }
    return $null
}

function Start-DesktopHost([string]$dshHome, [int]$port) {
    $exe = Join-Path $dshHome 'desktop-host\win32-x64\dsh-desktop.exe'
    if (-not (Test-Path $exe)) { Write-Log '未安装桌面宿主，跳过桌面窗口'; return $false }
    if (Get-Process -Name 'dsh-desktop' -ErrorAction SilentlyContinue) {
        Write-Log '桌面窗口已在运行'
        return $true
    }
    $hostArgs = @('--url', "http://127.0.0.1:$port", '--home', $dshHome)
    Start-Process -FilePath $exe -ArgumentList $hostArgs -WindowStyle Normal
    Write-Log "已启动桌面窗口：$exe $($hostArgs -join ' ')"
    return $true
}

# ---------------- 主流程 ----------------
$cfg = Read-Config
$port = [int]$cfg.port
$url = "http://127.0.0.1:$port"
$dshHome = $env:DSH_HOME
if ([string]::IsNullOrWhiteSpace($dshHome)) { $dshHome = Join-Path $HOME '.dsh' }

# 启动 dsh web 时的工作目录（决定新会话默认工作区）。留空则用用户主目录。
$workDir = "$($cfg.workdir)"
if ([string]::IsNullOrWhiteSpace($workDir) -or -not (Test-Path $workDir)) { $workDir = $env:USERPROFILE }

Write-Log "launcher: start (port=$port, openMode=$($cfg.openMode), DSH_HOME=$dshHome, discoverOnly=$DiscoverOnly)"

if ($DiscoverOnly) {
    $rt = Resolve-Runtime $cfg.runtimeDir
    if ($null -eq $rt) { Write-Log 'DiscoverOnly: 未找到 dsh 运行时'; exit 1 }
    if ($rt.kind -eq 'node') {
        $node = Resolve-Node $cfg.nodePath
        if ($null -eq $node) { Write-Log 'DiscoverOnly: 找到运行时但没找到 node.exe'; exit 1 }
        $cfg.runtimeDir = Get-RuntimeDirFromBin $rt.bin
        $cfg.nodePath = $node
    }
    Save-Config $cfg
    Write-Log "DiscoverOnly: kind=$($rt.kind) source=$($rt.source) runtimeDir=$($cfg.runtimeDir) node=$($cfg.nodePath)"
    exit 0
}

$running = Test-TcpPort $port
Write-Log "harness listening (tcp): $running"

if (-not $running) {
    $rt = Resolve-Runtime $cfg.runtimeDir
    if ($null -eq $rt) {
        Show-Notice("找不到 dsh 运行时，无法启动。`n`n已尝试：launch-config.json、DSH_RUNTIME_DIR、PATH、pnpm store、pnpm dlx、npm 全局。`n`n请在 DSH 安装正常的环境重跑 install-into-dsh.ps1，或把 dsh 加入 PATH。`n`n日志：$log")
        exit 1
    }
    Write-Log "runtime resolved: kind=$($rt.kind) source=$($rt.source)"

    if ($rt.kind -eq 'node') {
        $node = Resolve-Node $cfg.nodePath
        if ($null -eq $node) {
            Show-Notice("找到了 dsh 运行时，但找不到 node.exe。`n`n请安装 Node.js 或把它加入 PATH。`n`n日志：$log")
            exit 1
        }
        # 记住这次成功的组合，下次直接用
        $cfg.runtimeDir = Get-RuntimeDirFromBin $rt.bin
        $cfg.nodePath = $node
        Save-Config $cfg
        $exe = $node
        $argStr = '"{0}" web --no-open --port {1}' -f $rt.bin, $port
    } else {
        $exe = 'cmd.exe'
        $argStr = '/c "{0}" web --no-open --port {1}' -f $rt.cmd, $port
    }

    Write-Log "spawning: $exe $argStr"
    try {
        Start-Process -FilePath $exe -ArgumentList $argStr `
            -WorkingDirectory $workDir -WindowStyle Hidden `
            -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
    } catch {
        Show-Notice("启动 dsh web 失败：$($_.Exception.Message)`n`n日志：$log")
        exit 1
    }

    $up = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        if (Test-TcpPort $port) { $up = $true; Write-Log "port $port up after $((($i + 1) * 2))s"; break }
    }
    if (-not $up) {
        Show-Notice("已启动 dsh web，但 120 秒内 $port 没有就绪。`n`n服务端错误日志：`n$serverErr`n`n启动日志：`n$log")
        exit 1
    }
    Start-Sleep -Seconds 1
}

switch ("$($cfg.openMode)") {
    'desktop' {
        [void](Start-DesktopHost $dshHome $port)
        Write-Log 'openMode=desktop：已确保桌面窗口，不打开浏览器'
    }
    'both' {
        Start-Process $url
        Write-Log "已在默认浏览器打开 $url"
        [void](Start-DesktopHost $dshHome $port)
    }
    default {
        Start-Process $url
        Write-Log "已在默认浏览器打开 $url"
    }
}
exit 0
