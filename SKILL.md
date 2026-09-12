---
name: dsh-desktop-whale
description: 给 DeepSeek Harness (DSH) 加两样东西：桌面上双击即启动的入口（DeepSeek 官方大鲸鱼图标），以及界面右下角常驻的小鲸鱼挂件（点击显示 DeepSeek 账户余额与 token 用量）。也适用于单独排障：桌面快捷方式双击没反应、启动入口报"找不到 dsh 命令"、挂件不出现或显示"暂不可用"、桌面宿主 dsh-desktop.exe 装不上、需要把官方鲸鱼标记做成 .ico。Add a desktop launcher with the official DeepSeek whale icon and a floating whale widget showing account balance to a DSH installation, or troubleshoot an existing one.
whenToUse: 用户想要"桌面入口 / 桌面快捷方式 / 双击启动 DSH / 大鲸鱼图标 / 小鲸鱼挂件 / 看余额 / 看 token 剩余 / 桌面端"，或者上述东西坏掉需要排查时使用。
---

# DSH 桌面入口 + 鲸鱼挂件

把一个 DSH 安装变成"桌面上有图标、界面里有挂件"的形态。全部产物落在一个自包含目录里，
对 DSH 的侵入只有 3 处，可用一个脚本完整回滚。

## 先读这一条：三个会让人白干半天的约束

1. **动态 Cordis 插件永远无法读本机路由。** Host 侧 `ctx.get('web').fetch()` 会拒绝非公网
   IP（`WEB_BLOCKED_URL`），Client 侧动态沙箱里没有 `fetch` builtin。所以挂件**必须做成
   持久化的真实插件**（`profiles/<name>/node_modules/<pkg>` + `cordis.patch.yml` 一行），
   让浏览器半边用普通浏览器 `fetch('/api/billing')` 取同源数据。别在动态插件上耗时间。
2. **`dsh` 很可能不在用户的持久 PATH 里。** 你在 DSH 会话里能 `Get-Command dsh`，是因为
   会话继承了 DSH 进程的环境；桌面双击启动的进程看到的是**用户/机器持久 PATH**，那里
   往往没有 `dsh`。启动入口必须自己**发现运行时**（本 skill 的 `launch-dsh.ps1` 已实现）。
3. **`.ps1` 必须带 UTF-8 BOM。** Windows PowerShell 5.1 对无 BOM 的脚本按 ANSI(GBK) 解析，
   文件里的中文注释/字符串会直接变成语法错误。写完脚本务必跑 `build/add-bom.cjs`。

## 适用前提

- 平台：Windows（启动入口与 `.ico` 部分只针对 Windows；插件本身跨平台）。
- 一个可用的 DSH 安装，`$DSH_HOME` 一般为 `%USERPROFILE%\.dsh`。
- Web profile 已能跑起来（`dsh web`），端口默认 3080。
- 计费数据来源：`dsh-desktop-tools` 插件提供 `GET /api/billing`（余额 + token 用量 + 估算花费）。
  装了它就自动有；没装则挂件会显示"暂不可用"并给出原因，不会造假数据。

## 总体架构

```
桌面快捷方式（大鲸鱼 .ico）
   └─ 启动 DeepSeek Harness.cmd → launch-dsh.ps1
         ├─ TCP 探活 127.0.0.1:3080
         │    ├─ 已在跑 → 用默认浏览器打开 http://127.0.0.1:3080
         │    └─ 没在跑 → 发现 dsh 运行时 → 起 `dsh web --no-open --port <port>` → 等就绪 → 开浏览器
         └─ openMode 决定是否同时拉起 dsh-desktop.exe（桌面窗口/托盘）

界面右下角小鲸鱼挂件（持久化插件 dsh-whale-widget）
   Client 半边：注册进 shell.overlay，fetch('/whale/billing')
   Host   半边：GET /whale/billing → 转发本机 GET /api/billing，只挑叶子字段
```

**API Key 全程不参与**：挂件读的是本机回环上的计费路由，Key 始终留在 DSH 进程内。

## 标准流程

### 第 0 步：侦察，不要猜

```powershell
# dsh 到底能不能从"普通用户进程"看到？看持久 PATH，而不是当前会话 PATH
([Environment]::GetEnvironmentVariable('Path','User')) -split ';'
([Environment]::GetEnvironmentVariable('Path','Machine')) -split ';'
# 端口与服务
netstat -ano | Select-String ':3080'
# 计费来源在不在
Invoke-WebRequest http://127.0.0.1:3080/api/billing -UseBasicParsing
# 桌面宿主状态（dsh-desktop-tools 提供）
Invoke-WebRequest http://127.0.0.1:3080/api/desktop -UseBasicParsing
```

注意：**别用 `Invoke-WebRequest http://127.0.0.1:3080` 判断服务在不在**——首页对非浏览器请求
返回 **401**，PS 会抛异常，你会误判成"没在跑"。用 TCP 连接判断。

### 第 1 步：拿官方鲸鱼图形并生成 .ico

先证明拿到的确实是官方标记，再动手做图：

```powershell
cd <skill>\build
node provenance-check.cjs      # 校验 favicon.svg 与 bundle 里的 FISH_LOGO_PATH 是同一形状（IoU ≥ 0.9）
node build-icons.cjs           # 生成 assets\deepseek-whale.ico（7 档尺寸）+ PNG/SVG 素材
node verify-ico.cjs            # 逐条校验 ICO 目录项与 PNG 能解码
node verify-pixels.cjs         # 像素构成自检：蓝底 + 居中白鲸
```

来源依据（写进交付说明，别省略）：`@deepseek-ai/dsh-client-ui-brand-official` 的 `FishLogo`
JSDoc 写明是 "the official whale mark"；前端 bundle 里的 `FISH_LOGO_PATH` 常量是它的路径；
官方 `dist/favicon.svg` 与该常量形状 IoU ≈ 0.976。

`build-icons.cjs` 会在 `$DSH_HOME/profiles/*/node_modules` 里自动找 `sharp`；找不到就先 `npm i sharp`。

### 第 2 步：写/更新挂件插件

插件模板在 `plugin/dsh-whale-widget/`：`package.json`（`dsh.bundle.patch` + `dsh.client`）、
`cordis.patch.yml`（insert 一行）、`lib/index.js`（Host 半边，注册 `/whale/billing`）、
`lib/client.js`（浏览器半边，注册进 `shell.overlay`）。

改源码后重新生成并自测：

```powershell
node build-plugin.cjs        # src/ → lib/，把官方鲸鱼路径内联进 client.js，并做语法检查
node test-host-half.cjs      # 用桩 ctx 端到端跑 Host 半边，会打印真实余额
node test-client-half.cjs    # 用假 window.__ModuleLoader__ 跑浏览器半边，校验注册参数
```

Client 半边两条硬约束：只能用 `React.createElement`（**不能写 JSX**，没有构建步骤），
并且 `slots` 要声明成硬依赖（`exports.inject = ["slots"]`），否则会和 slots 服务抢跑。

### 第 3 步：装进 DSH

```powershell
powershell -ExecutionPolicy Bypass -File install-into-dsh.ps1
```

它做 4 件事（幂等，可重复跑）：建 junction、往 `cordis.patch.yml` 追加 insert 行、
安装桌面宿主二进制、把发现的 dsh 运行时写进 `launch-config.json`。

源码放工作区、只在 `node_modules` 里放 **junction**，是为了让源码可版本管理、可随时改。
代价：`dsh plugin add/remove` 这类操作可能把 junction 清掉，遇到就重跑本脚本。

### 第 4 步：桌面宿主（可选，但"桌面端"体验靠它）

`dsh-desktop-tools` 自带的 Tauri 宿主（约 5 MB）在安装时经常抓取失败（`fetch failed`）。
先看状态，再补：

```powershell
Invoke-WebRequest http://127.0.0.1:3080/api/desktop -UseBasicParsing
node build\download-host2.cjs     # 先测通道吞吐再流式下载，带镜像回退与 MZ/大小校验
powershell -ExecutionPolicy Bypass -File install-into-dsh.ps1   # 幂等，会把它放到 desktop-host\win32-x64\
Invoke-WebRequest http://127.0.0.1:3080/api/desktop -Method Post  # 立刻拉起桌面窗口
```

宿主启动契约：`dsh-desktop.exe --url http://127.0.0.1:<port> --home <DSH_HOME>`。

### 第 5 步：桌面快捷方式

```powershell
powershell -ExecutionPolicy Bypass -File install-desktop-shortcut.ps1
```

在桌面创建 `DeepSeek Harness.lnk`，目标为 `启动 DeepSeek Harness.cmd`，图标为本仓库的
大鲸鱼 `.ico`，`WindowStyle=7`（最小化，避免控制台挡屏）。

### 第 6 步：验证（不要只看"应该能行"）

| 验什么 | 怎么验 | 期望 |
|---|---|---|
| Host 半边挂上 | `GET /whale/billing` | 200 + `ok:true` + 真实余额 |
| 数据可比对 | `/whale/billing` 与 `/api/billing` | 金额一致 |
| 客户端半边已注册 | 起一个动态 Host 探针读 `ctx.get('clientModules').clientPath('<pkg>')` | 返回 `lib/client.js` 路径 |
| 首页会加载它 | `clientModules.graph().entries[].id` 里能看到包名 | 在列 |
| bundle 真能取 | `GET /plugins/??<pkg>/client.js&rev=<rev>` | 200 + 含包名 |
| 桌面入口可用 | 直接执行那个 `.cmd` | `exit=0`，日志出现"已在默认浏览器打开" |
| 重启后仍有效 | 重启 DSH 进程后再验前两行 | 仍然 200 |

**重要**：`dsh-client-modules` 是**增量扫描**的，插件行加进去后**不需要重启 DSH**，
浏览器**刷新一次**即可（它的模块图会把新 bundle 一起注入首页）。

`GET /plugins/<pkg>/client.js`（单 id）会 404 —— 这是正常的，真实 URL 是合批形式
`/plugins/??<id1>/client.js,<id2>/client.js&rev=<rev>`，带 `rev` 才 200。

### 第 7 步：回滚

```powershell
powershell -ExecutionPolicy Bypass -File uninstall-from-dsh.ps1
```
摘掉 patch 行、删 junction（保留工作区源码）、删桌面宿主。桌面 `.lnk` 需手动删（脚本不动用户桌面）。

## 排障速查

| 现象 | 先看 / 先做 |
|---|---|
| 双击图标没反应 | `<root>\logs\dsh-web.log`。若"找不到 dsh 运行时"→ `launch-dsh.ps1 -DiscoverOnly` |
| 网站没打开 | 确认探活用 TCP 而不是 HTTP（首页 401 会让 `Invoke-WebRequest` 抛异常） |
| 挂件没出现 | 刷新页面；确认 junction 还在；确认 `exports.inject = ["slots"]` |
| 挂件"暂不可用" | `logs\dsh-web-server.err.log`；上游 `/api/billing` 是否可用 |
| 宿主装不上 | `GET /api/desktop` 看 `acquisition.state`；`build\download-host2.cjs` |
| `.ps1` 报中文语法错误 | 跑 `build\add-bom.cjs` 补 UTF-8 BOM |
| Node 脚本报 `Unexpected identifier` | 检查块注释里是不是写了 `*/`（例如路径里的 `profiles/*/`） |

更细的内容见：

- `references/architecture.md` —— 数据链路、插件双半边、IPC 与样式约定
- `references/pitfalls.md` —— 所有踩过的坑与根因（含反例代码）
- `references/verification.md` —— 可复制的验证命令与判据

## 边界

- 不改动 DSH 的 shipped preset 安装目录；不动 `cordis.yml`（它每次启动被重写），
  自建行只写 `cordis.patch.yml`。
- 不代管、不落盘、不回显用户的 API Key。
- 不引入来源不明的预编译二进制；宿主二进制只从官方 Release 取并校验 MZ 与大小。
