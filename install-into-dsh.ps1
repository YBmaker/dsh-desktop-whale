# install-into-dsh.ps1 —— 把鲸鱼挂件与桌面宿主装入 DSH（幂等，可重复运行）
#
# 做三件事（全部在 $DSH_HOME 下，工作区之外）：
#   1) 在 profiles\web\node_modules 里为插件源码建 junction（源码始终留在工作区）
#   2) 在 profiles\web\cordis.patch.yml 追加一行 insert（幂等，已存在则跳过）
#   3) 安装桌面宿主 dsh-desktop.exe 到 desktop-host\win32-x64 并写 VERSION / 状态
#
# 注意：所有文本读写都走 .NET UTF-8(无 BOM) / ReadAllText，避免 PowerShell 的
#       ANSI 默认编码破坏 YAML 与 JSON。
$ErrorActionPreference = 'Stop'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Text([string]$p) {
    return [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
}
function Write-Text([string]$p, [string]$t) {
    [System.IO.File]::WriteAllText($p, $t, $utf8NoBom)
}

# 脚本所在目录即本工具根目录（不再写死本机路径，便于打包成可复用 skill）
$ws = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ws)) { $ws = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$dshHome = $env:DSH_HOME
if ([string]::IsNullOrWhiteSpace($dshHome)) { $dshHome = Join-Path $HOME '.dsh' }
$profileDir = Join-Path $dshHome 'profiles\web'
$pluginTarget = Join-Path $ws 'plugin\dsh-whale-widget'
$linkPath = Join-Path $profileDir 'node_modules\dsh-whale-widget'

Write-Output "DSH_HOME = $dshHome"
Write-Output "profile  = $profileDir"

# ---------- 1) junction ----------
if (-not (Test-Path $pluginTarget)) { throw "插件源码不存在: $pluginTarget" }
if (Test-Path $linkPath) {
    $item = Get-Item $linkPath -Force
    $ok = ($item.LinkType -eq 'Junction') -and ($item.Target -contains $pluginTarget)
    if ($ok) {
        Write-Output "[1/4] junction 已存在且指向正确，跳过"
    } else {
        Write-Output "[1/4] junction 需要重建（当前: $($item.LinkType) $($item.Target)）"
        cmd /c rmdir "$linkPath" | Out-Null
        New-Item -ItemType Junction -Path $linkPath -Target $pluginTarget | Out-Null
    }
} else {
    New-Item -ItemType Junction -Path $linkPath -Target $pluginTarget | Out-Null
    Write-Output "[1/4] 已建立 junction: $linkPath -> $pluginTarget"
}
Write-Output "      lib\client.js 可达: $(Test-Path (Join-Path $linkPath 'lib\client.js'))"

# ---------- 2) profile patch 行 ----------
$patchFile = Join-Path $profileDir 'cordis.patch.yml'
if (-not (Test-Path $patchFile)) { throw "找不到 $patchFile" }
$content = Read-Text $patchFile
if ($content -match 'whale-widget') {
    Write-Output "[2/4] cordis.patch.yml 已含 whale-widget 行，跳过"
} else {
    $nl = "`n"
    if (-not $content.EndsWith($nl)) { $content += $nl }
    $content += "- insert:$nl    - id: whale-widget$nl      name: 'dsh-whale-widget'$nl"
    Write-Text $patchFile $content
    Write-Output "[2/4] 已向 cordis.patch.yml 追加 whale-widget 行"
}
Write-Output "----- cordis.patch.yml 现状 -----"
(Read-Text $patchFile) -split "`n" | ForEach-Object { "  $_" }
Write-Output "---------------------------------"

# ---------- 3) 桌面宿主二进制 ----------
$hostSrc = Join-Path $ws 'build\dsh-desktop.exe'
$hostMeta = "$hostSrc.meta.json"
$hostDir = Join-Path $dshHome 'desktop-host\win32-x64'
$hostDst = Join-Path $hostDir 'dsh-desktop.exe'
if (Test-Path $hostSrc) {
    New-Item -ItemType Directory -Force -Path $hostDir | Out-Null
    Copy-Item $hostSrc $hostDst -Force
    $ver = 'unknown'
    if (Test-Path $hostMeta) {
        $meta = (Read-Text $hostMeta) | ConvertFrom-Json
        if ($meta.tag) { $ver = $meta.tag }
    }
    if ($ver -ne 'unknown') { Write-Text (Join-Path $dshHome 'desktop-host\VERSION') "$ver`n" }
    $status = [ordered]@{
        at     = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        state  = 'ready'
        path   = $hostDst
        source = "manual install from GitHub Release $ver"
    } | ConvertTo-Json
    Write-Text (Join-Path $dshHome 'desktop-host\ensure-status.json') $status
    $size = (Get-Item $hostDst).Length
    Write-Output "[3/4] 桌面宿主已安装: $hostDst ($size 字节, 版本 $ver)"
} else {
    Write-Output "[3/4] 跳过：尚未下载 build\dsh-desktop.exe（先运行 build\download-host2.cjs）"
}

# ---------- 4) 记录 dsh 运行时（桌面入口靠它启动服务） ----------
$launcher = Join-Path $ws 'launch-dsh.ps1'
if (Test-Path $launcher) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -DiscoverOnly
    if (Test-Path (Join-Path $ws 'launch-config.json')) {
        Write-Output '[4/4] 已把 dsh 运行时写入 launch-config.json（桌面入口据此启动）'
    } else {
        Write-Output '[4/4] 未能写入 launch-config.json（桌面入口仍会自动发现运行时）'
    }
} else {
    Write-Output '[4/4] 找不到 launch-dsh.ps1，跳过'
}

Write-Output 'install-into-dsh.ps1 完成'
