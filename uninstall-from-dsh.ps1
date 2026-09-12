# uninstall-from-dsh.ps1 —— 完整回滚本方案对 DSH 所做的全部改动（幂等）
#
# 移除：
#   1) profiles\web\cordis.patch.yml 中的 whale-widget insert 行
#   2) profiles\web\node_modules\dsh-whale-widget 这个 junction（不会删到工作区源码）
#   3) desktop-host\win32-x64\dsh-desktop.exe 与 VERSION / ensure-status.json
# 另需手动删除（本脚本不动用户桌面，只给提示）：桌面上的 DeepSeek Harness.lnk
$ErrorActionPreference = 'Continue'

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$dshHome = $env:DSH_HOME
if ([string]::IsNullOrWhiteSpace($dshHome)) { $dshHome = Join-Path $HOME '.dsh' }
$profileDir = Join-Path $dshHome 'profiles\web'
$patchFile = Join-Path $profileDir 'cordis.patch.yml'
$linkPath = Join-Path $profileDir 'node_modules\dsh-whale-widget'
$hostDir = Join-Path $dshHome 'desktop-host'

# ---------- 1) 摘掉 patch 行 ----------
if (Test-Path $patchFile) {
    $content = [System.IO.File]::ReadAllText($patchFile, [System.Text.Encoding]::UTF8)
    $lines = $content -split "`n"
    $kept = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match '^\s*-\s*insert:\s*$') {
            $next1 = if ($i + 1 -lt $lines.Count) { $lines[$i + 1] } else { '' }
            $next2 = if ($i + 2 -lt $lines.Count) { $lines[$i + 2] } else { '' }
            if ($next1 -match 'whale-widget' -and $next2 -match 'dsh-whale-widget') {
                $i += 2   # 跳过整个 insert 块
                continue
            }
        }
        $kept.Add($line)
    }
    [System.IO.File]::WriteAllText($patchFile, ($kept -join "`n"), $utf8NoBom)
    if ($content -match 'whale-widget') { Write-Output '[1/3] 已从 cordis.patch.yml 移除 whale-widget 行' }
    else { Write-Output '[1/3] cordis.patch.yml 本来就没有 whale-widget 行' }
} else {
    Write-Output "[1/3] 找不到 $patchFile，跳过"
}

# ---------- 2) 删除 junction ----------
if (Test-Path $linkPath) {
    $item = Get-Item $linkPath -Force
    if ($item.LinkType -eq 'Junction') {
        cmd /c rmdir "$linkPath" | Out-Null
        Write-Output "[2/3] 已删除 junction: $linkPath（工作区源码保留）"
    } else {
        Write-Output "[2/3] $linkPath 不是 junction，拒绝删除"
    }
} else {
    Write-Output '[2/3] junction 不存在，跳过'
}

# ---------- 3) 删除桌面宿主 ----------
if (Test-Path $hostDir) {
    Remove-Item $hostDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $hostDir) { Write-Output "[3/3] 删除 $hostDir 失败（可能被桌面端占用，请先退出 dsh-desktop）" }
    else { Write-Output "[3/3] 已删除 $hostDir" }
} else {
    Write-Output '[3/3] desktop-host 目录不存在，跳过'
}

Write-Output ''
Write-Output '还需手动处理（脚本不修改桌面）：'
Write-Output "  1) 删除桌面快捷方式: $([Environment]::GetFolderPath('Desktop'))\DeepSeek Harness.lnk"
Write-Output "  2) 若要连本工具目录一起清理，可删除: $ws"
Write-Output '  3) 重启 DSH 使插件行卸载生效'
Write-Output 'uninstall-from-dsh.ps1 完成'
