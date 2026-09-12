# 踩过的坑与根因

按"会不会让人白干半天"排序。每条都给出**可复现的现象**、**根因**、**正确做法**。

---

## 1. 动态 Cordis 插件读不到本机路由（最容易白干）

**现象**：想用动态插件取 `http://127.0.0.1:3080/api/billing`，Host 半边报错。

```
WebError  WEB_BLOCKED_URL
URL hostname "127.0.0.1" resolves to a non-public IP address
```

**根因**：Host 侧 `ctx.get('web')` 的 fetch provider 有 SSRF 防护，**拒绝一切非公网 IP**；
而 Client 侧动态沙箱的 builtin 列表里**根本没有 `fetch`**（只有 `ctx` / `React` / `host` /
`styles` / `console`）。

**正确做法**：挂件做成**持久化真实插件**。真实插件是普通模块/普通浏览器包，不受动态沙箱
限制：

- 浏览器半边直接用浏览器原生 `fetch('/api/billing')`（同源，无需 CORS）；
- 需要给桌面小程序复用时，在 Host 半边注册一条同源只读路由（本 skill 的 `/whale/billing`）。

**顺带结论**：Host 侧 `harness.handle` + Client 侧 `host.call` 是"包内私有 JSON RPC"，
适合传数据，但它解决不了"数据从哪来"的问题——取本机数据只能靠真实插件。

---

## 2. `dsh` 不在用户的持久 PATH 里

**现象**：桌面快捷方式双击后什么都没发生，日志写着：

```
ERROR: 在 PATH 中找不到 dsh 命令。
```

**根因**：在 DSH 会话里 `Get-Command dsh` 能成功，是因为会话继承了 DSH 进程的环境
（例如 `pnpm dlx` 往 PATH 里塞了 `...\pnpm-cache\dlx\<hash>\...\.bin`）。
但**桌面双击**启动的进程看到的是用户/机器**持久** PATH。实测某台机器：用户 PATH 只含
Python、WindowsApps、`%APPDATA%\npm` 三类目录；机器 PATH 只有 Windows 系统目录和一个
自定义的 Node 存放目录——**两者都没有 `dsh`**，所以脚本一定找不到它。

**正确做法**：启动入口自己发现运行时，按可靠性排序：

1. 配置文件里记住的 `runtimeDir`；
2. `DSH_RUNTIME_DIR`；
3. PATH 里的 `dsh`；
4. pnpm store：`%LOCALAPPDATA%\pnpm\store\v11\links\@deepseek-ai\dsh\<ver>\<hash>\`，
   取 `node_modules\@deepseek-ai\dsh\lib\bin.js`，用 `node <bin.js>` 跑；
5. pnpm dlx 缓存里的 `dsh.CMD`；
6. `%APPDATA%\npm\dsh.cmd`。

发现成功后**写回配置**，下次直接用。注意 `<hash>` 目录的推导不要用连写三个
`Split-Path -Parent`（那会停在 `...\@deepseek-ai`），要精确匹配
`\lib\bin.js` 与 `\node_modules\@deepseek-ai\dsh` 两段。

---

## 3. 用 HTTP 探活会被 401 骗到

**现象**：服务明明在跑，启动脚本却认为"没在跑"，于是又去起第二个实例。

**根因**：`Invoke-WebRequest http://127.0.0.1:3080` 对**首页**返回 **401**（浏览器会话鉴权），
PowerShell 把它当异常抛出，`try/catch` 里返回 `false`。

**正确做法**：用 TCP 连接判断，与鉴权无关：

```powershell
$client = New-Object System.Net.Sockets.TcpClient
$iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
$up = $iar.AsyncWaitHandle.WaitOne(1500)
if ($up) { $client.EndConnect($iar) }
$client.Close()
```

注：`Get-NetTCPConnection` 在受限环境里可能返回空，`netstat -ano` 更可靠。

---

## 4. `.ps1` 没有 UTF-8 BOM → 中文变语法错误

**现象**：

```
Unexpected token '瀛楄妭' in expression or statement.
Missing closing ')' in expression.
```

**根因**：Windows PowerShell 5.1 对**无 BOM** 的 `.ps1` 按 ANSI(GBK) 解析，UTF-8 的中文
字节被拆成乱码，连引号配对都会被打乱。

**正确做法**：所有 `.ps1` 存 UTF-8 **带 BOM**（`build/add-bom.cjs` 幂等补 BOM）。
另外：读写 JSON/YAML 时统一走 .NET，避免 PowerShell 的默认编码：

```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($p, $text, $utf8NoBom)
```

> 顺带：`Set-Content -Encoding UTF8` 在 5.1 下会写**带 BOM** 的 UTF-8；往 YAML 里追加内容时
> 请用上面的 `WriteAllText`，否则 YAML 首部会多出 BOM。

---

## 5. 块注释里的 `*/` 会截断注释

**现象**：Node 报 `SyntaxError: Unexpected identifier`，指向一行看起来完全正常的注释。

**根因**：注释里写了路径通配，例如

```js
/** 从 profiles/*/node_modules 里找 sharp */
```

其中的 `*/` 提前结束了块注释，后面的中文变成了"代码"。

**正确做法**：注释里避免 `*/`（写成"各 profile 的 node_modules"或 `profiles/<name>/`）。
`//` 行注释里出现 `*/` 无害，但统一避开更省心。

---

## 6. 手工装的 junction 会被 `dsh plugin` 清掉

**现象**：挂件突然消失，`node_modules\<pkg>` 不见了。

**根因**：源码放在工作区、`node_modules` 里只放 junction，是为了源码可版本管理；
但 `dsh plugin --profile <name> add/remove ...` 会重排 `node_modules`，把非 pnpm 管理的
条目清掉。

**正确做法**：重跑 `install-into-dsh.ps1`（幂等）。把它写进交付说明与排障表。

---

## 7. 改了插件不需要重启 DSH

**现象**：以为要重启 DSH 才能让挂件生效，于是中断了用户正在用的服务。

**根因**：误解。`dsh-client-modules` 对 `dsh.client` 声明是**增量扫描**的：把插件行写进
`cordis.patch.yml` 后，Host 半边会被挂载，客户端 bundle 也会进入模块图（`clientModules.clientPath()`
能查到、`graph().entries[].id` 里有它）。

**正确做法**：**刷新一次页面**即可。只有改动 Host 半边代码时才建议重启。

---

## 8. `GET /plugins/<pkg>/client.js` 404 是正常的

**现象**：探测客户端 bundle 一律 404，连官方插件也 404 → 容易误判成"没注册成功"。

**根因**：真实 URL 是**合批**形式，并且需要 `rev`：

```
/plugins/??<id1>/client.js,<id2>/client.js&rev=<rev>     → 200
/plugins/??<id1>/client.js                                → 404
/plugins/<id1>/client.js                                  → 404
```

**正确做法**：要判断"注没注进去"，不要猜 URL，直接问服务本身：

```js
ctx.get('clientModules').clientPath('<pkg>')   // 返回 lib/client.js 的绝对路径 = 已注册
ctx.get('clientModules').rebuilt('<pkg>')      // 返回修订号
ctx.get('webServer').collectIndexInjections()  // 首页真实注入行（含合批 URL）
```

---

## 9. 图标来源必须能自证

**现象**：随便找个鲸鱼 png 当图标，交付时无法说明来源与许可。

**正确做法**：用 DSH 官方发行物里的标记，并留下证据链：

1. `@deepseek-ai/dsh-client-ui-brand-official/lib/client.js` 渲染 `FishLogo`，
   JSDoc 明确写 "the official whale mark"；
2. 前端 bundle 里的 `FISH_LOGO_PATH` 常量（viewBox `23.16 × 17.04`）就是它的路径；
3. 官方 `dist/favicon.svg` 与该常量形状 **IoU ≈ 0.976**（`build/provenance-check.cjs` 可复现）。

`.ico` 的写法也要讲究：**≤64px 用 BMP(DIB) 条目、>64px 用 PNG 条目**，且每条 32bpp；
`build/verify-ico.cjs` 会逐条校验目录项与 PNG 能否解码。
（注意 `System.Drawing.Icon` 请求 256 会回退到 128，这是 GDI+ 的已知局限，不代表文件坏了。）

---

## 10. 桌面宿主抓取失败不等于网络不通

**现象**：`/api/desktop` 返回

```json
{"exists":false,"acquisition":{"state":"failed","error":"fetch failed"}}
```

**根因**：`dsh-desktop-tools` 的 `ensure-host.mjs` 从 GitHub Release 抓 Tauri 宿主。
失败可能只是**资产 CDN 慢/被重置**（`api.github.com` 通、`objects.githubusercontent.com` 不通是常见组合），
而不是全网络不通。另外在受限执行的进程里，`curl`/schannel 的 TLS 可能直接被拦
（`SEC_E_NO_CREDENTIALS`），而 **Node 的 fetch 仍可用**——别因为 curl 失败就断定没网。

**正确做法**：`build/download-host2.cjs` —— 先用 Range 请求测各通道吞吐，挑最快的通道，
再流式下载并校验 MZ 头与声明大小，最后幂等安装（写 `VERSION` 与 `ensure-status.json`）。
安装后 `POST /api/desktop` 可立即拉起桌面窗口，无需重启。
