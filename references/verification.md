# 验证手册

原则：**每一行结论都要有命令或字节作证**。下面所有命令都可直接复制。

## 0. 环境侦察

```powershell
# dsh 在不在"普通用户进程"的 PATH 里？看持久 PATH，不是当前会话 PATH
([Environment]::GetEnvironmentVariable('Path','User'))  -split ';' | Where-Object { $_ }
([Environment]::GetEnvironmentVariable('Path','Machine')) -split ';' | Where-Object { $_ }

# 服务在不在（TCP，不受 401 影响）
netstat -ano | Select-String ':3080.*LISTENING'

# 计费来源（挂件的数据源）
(Invoke-WebRequest 'http://127.0.0.1:3080/api/billing' -UseBasicParsing).Content

# 桌面宿主状态
(Invoke-WebRequest 'http://127.0.0.1:3080/api/desktop' -UseBasicParsing).Content
```

## 1. 图标：来源、结构、像素

```powershell
cd <root>\build
node provenance-check.cjs    # 期望：形状 IoU ≈ 0.976，PASS
node build-icons.cjs         # 期望：deepseek-whale.ico 7 条目
node verify-ico.cjs          # 期望：ALL PASS（每条 32bpp、inRange=true、png 能解码）
node verify-pixels.cjs       # 期望：ALL PASS（方底图前景居中、留白；标记图铺满宽度）
```

Windows 侧再确认一遍系统能读：

```powershell
Add-Type -AssemblyName System.Drawing
$ico = New-Object System.Drawing.Icon '<root>\assets\deepseek-whale.ico'
"$($ico.Width)x$($ico.Height)"
foreach ($s in 16,32,48,64,128) {
  $i = New-Object System.Drawing.Icon '<root>\assets\deepseek-whale.ico',$s,$s
  "$s -> $($i.Width)x$($i.Height)"
}
```

> 请求 256 得到 128 是 GDI+ 的已知局限，不是文件损坏。

## 2. 插件：两个半边各自可测

```powershell
cd <root>\build
node build-plugin.cjs     # src/ → lib/，语法检查
node test-host-half.cjs   # 桩 ctx 端到端跑 Host 半边：会打印真实余额；POST 应得 405
node test-client-half.cjs # 假 window.__ModuleLoader__ 跑浏览器半边：应注入 shell.overlay 并注册 id=whale-widget
```

装好之后（服务在跑）：

```powershell
# Host 半边挂上了吗
(Invoke-WebRequest 'http://127.0.0.1:3080/whale/billing' -UseBasicParsing).Content
# 期望 {"ok":true,...,"billing":{"totalBalance":<数字>,...}}

# 与权威来源比对，金额必须一致
$a = (Invoke-WebRequest 'http://127.0.0.1:3080/whale/billing' -UseBasicParsing).Content | ConvertFrom-Json
$b = (Invoke-WebRequest 'http://127.0.0.1:3080/api/billing'  -UseBasicParsing).Content | ConvertFrom-Json
"$($a.billing.totalBalance) vs $($b.balance.totalBalance)"
```

## 3. 客户端 bundle：用"问服务"代替"猜 URL"

单 id 的 `/plugins/<pkg>/client.js` **一定 404**，别用它判断。用一段临时动态 Host 插件
把真实情况读出来（这是最省事的权威手段）：

```js
// cordis_define 的 code.host 主体
return {
  apply(ctx) {
    const ws = ctx.get('webServer');
    const cm = ctx.get('clientModules');
    if (ws === undefined) return;
    ctx.effect(() => ws.register({
      kind: 'exact', path: '/whale-verify',
      handler: async (req, res) => {
        const out = {};
        out.clientPath = cm ? (cm.clientPath('dsh-whale-widget') || null) : 'no-service';
        out.rebuilt = cm ? String(cm.rebuilt('dsh-whale-widget') || '') : '';
        const g = cm ? cm.graph() : null;
        if (g && Array.isArray(g.entries)) {
          out.count = g.entries.length;
          out.hasOurs = g.entries.some((e) => e && e.id === 'dsh-whale-widget');
        }
        const rows = ws.collectIndexInjections();
        out.whaleRows = rows
          .filter((r) => (String(r.src || '') + String(r.name || '')).includes('whale'))
          .map((r) => ({ kind: r.kind, srcHead: String(r.src || '').slice(0, 120), srcLen: String(r.src || '').length }));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(out, null, 2));
      },
    }));
  },
}
```

```powershell
(Invoke-WebRequest 'http://127.0.0.1:3080/whale-verify' -UseBasicParsing).Content
```

期望：`clientPath` 指向 `plugin/dsh-whale-widget/lib/client.js`；`hasOurs = true`；
`whaleRows` 里有 `script-preload`，其 `src` 是**合批 URL**（`/plugins/??...client.js&rev=...`）。

拿到 `rev` 后可验证 bundle 真能取到：

```powershell
(Invoke-WebRequest 'http://127.0.0.1:3080/plugins/??dsh-whale-widget/client.js&rev=<rev>' -UseBasicParsing).Content.Length
# 期望 >10000，且内容含 "dsh-whale-widget"
```

用完把临时探针插件 `cordis_undefine` 掉。

## 4. 启动入口：行为与回归

```powershell
# 直接按"双击"的方式跑（服务在跑时应只开浏览器，exit=0）
& cmd.exe /c '"<root>\启动 DeepSeek Harness.cmd"'
"exit=$LASTEXITCODE"
Get-Content '<root>\logs\dsh-web.log' -Tail 5
# 期望出现：launcher: start / harness listening (tcp): True / 已在默认浏览器打开 http://127.0.0.1:3080

# 只验证"运行时发现"不启动进程
powershell -ExecutionPolicy Bypass -File '<root>\launch-dsh.ps1' -DiscoverOnly
Get-Content '<root>\launch-config.json' -Raw    # runtimeDir / nodePath 应被填上且真实存在
```

冷启动路径（服务没在跑）只能这样验：先把 DSH 全部退出，再双击入口，然后看
`logs\dsh-web-server.err.log` 与 `logs\dsh-web.log`。

## 5. 持久性：重启之后

重启 DSH 进程（或整机）后重跑第 2、3 节。判据：

- `/whale/billing` 仍 200；
- `clientModules.clientPath('dsh-whale-widget')` 仍能查到；
- 桌面快捷方式仍能一键打开界面。

只有"重启后仍然有效"才算真正交付——动态插件在重启后会消失，这条就是在排除它。

## 6. 回滚验证

```powershell
powershell -ExecutionPolicy Bypass -File '<root>\uninstall-from-dsh.ps1'
# 检查：cordis.patch.yml 里已无 whale-widget；node_modules\dsh-whale-widget 已消失（工作区源码仍在）
Get-Content "$env:DSH_HOME\profiles\web\cordis.patch.yml" -Raw
Test-Path "$env:DSH_HOME\profiles\web\node_modules\dsh-whale-widget"
```
