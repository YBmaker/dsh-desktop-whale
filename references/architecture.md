# 架构与实现细节

## 1. 数据链路（为什么不碰 API Key）

```
小鲸鱼挂件（浏览器半边，页面右下角）
   │  fetch('/whale/billing')            同源、只读
   ▼
本插件 Host 半边（DSH 进程内）
   │  GET http://127.0.0.1:<port>/api/billing
   ▼
dsh-desktop-tools（已在运行的计费来源）
   │  内部持有 DEEPSEEK_API_KEY（%DSH_HOME%\.credentials.yaml）
   ▼
DeepSeek 余额接口
```

要点：

- 浏览器与任何外部小程序**从不接触 API Key**；Key 只在 DSH 进程内使用。
- Host 半边**只挑叶子字段**下发（`pickBilling`）：`isAvailable / currency / totalBalance /
  grantedBalance / toppedUpBalance / usage.{input,output,cacheRead,cacheWrite,sessions} /
  estimatedCost / prices`。**绝不透传整个上游对象**。
- 上游不可用时返回 `{ok:false, error}`，挂件显示"暂不可用"+原因，**不显示假数据（不显示 0）**。
- 挂件有回退：`/whale/billing` 不可用时自动退到 `/api/billing`。

## 2. 插件双半边的形状

`dsh-whale-widget` 是一个"dual-face"包，靠 `package.json` 里的声明挂载：

```json
{
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "inject": [], "platform": "web", "immediately": true }
  }
}
```

- **Host 半边** = `exports["."]`，普通 Node ESM。因此 `fetch` / `process.env` 等全局可用
  （与动态 Cordis 插件的受限沙箱不同）。它导出 `name` / `inject` / `apply`。
- **浏览器半边** = `exports["./client"]`，由 `dsh-client-modules` 在 `/plugins/...` 下提供，
  在页面里通过 `window.__ModuleLoader__.load({ id, factory })` 求值。
- `cordis.patch.yml` 只做一件事：往花名册里 insert 一行。

```yaml
- insert:
    - id: whale-widget
      name: 'dsh-whale-widget'
```

- 装载落点：`%DSH_HOME%\profiles\<profile>\node_modules\<pkg>`（本 skill 用 junction 指回工作区源码）
  以及 `%DSH_HOME%\profiles\<profile>\cordis.patch.yml`。

**不要**改 `<profile>\cordis.yml`：那是 profile 根、每次启动被重写，文件里也写着"改 patch"。

## 3. 浏览器半边：Slot 与样式

- 落点是 `shell.overlay`：框架级浮层，位于所有列之上、滚动容器之外；
  该层**默认可点击穿透**，条目需自行开 `pointer-events: auto`。用**自建 id**
  （`id: 'whale-widget'`）是纯增量，不会替换任何既有 UI。
- `slots` 声明为硬依赖，避免与 slots 服务抢跑：

```js
function apply(ctx) {
  ctx.slots.inject('shell.overlay', function () {
    return ctx.slots.register({ name: 'shell.overlay', id: 'whale-widget', order: 50 }, Widget);
  });
}
exports.apply = apply;
exports.inject = ['slots'];   // 硬依赖
```

- **没有构建步骤**：只能用 `React.createElement`，不能写 JSX，不能用 `import`。
- 样式随组件内联 `<style>` 下发，颜色优先用主题变量（`--dsw-alias-bg-overlay`、
  `--dsw-alias-border-l1`、`--dsw-alias-label-primary/secondary/tertiary`、
  `--dsw-alias-state-error-primary`、`--dsw-alias-interactive-bg-hover`），
  这样深浅色主题都自动适配。
- 刷新策略：打开面板时每 60 秒自动刷新 + 手动"刷新"按钮；读取失败时按钮右上角显示红点。

## 4. 启动入口的行为矩阵

`launch-config.json`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `port` | `3080` | 探活与监听端口；会透传成 `dsh web --port` |
| `openMode` | `browser` | `browser` 开网站 / `desktop` 只拉起桌面窗口 / `both` |
| `runtimeDir` | 自动 | dsh 运行时目录，发现后写回 |
| `nodePath` | 自动 | 启动用的 node.exe |
| `workdir` | 空 | `dsh web` 的工作目录（决定新会话默认工作区）；空 = 用户主目录 |

流程：

```
TCP 探活 port
 ├─ 在跑  → 按 openMode 开浏览器 / 拉起桌面窗口（绝不重复起进程）
 └─ 没在跑 → 发现运行时 → Start-Process 隐藏窗口跑
             `node --expose-internals <bin.js> web --no-open --port <port>`（或 `dsh web ...`）
             → 轮询 TCP 最长 120s → 就绪后按 openMode 打开
```

细节：

- 用 `--no-open` 后再由脚本统一打开浏览器，保证"只开一个标签页"且行为确定。
- 直接执行 pnpm store 中的 `bin.js` 时加入 `--expose-internals`，让 Cordis loader 以 profile
  为解析基准；否则严格隔离布局会把已安装插件误报为 `ERR_MODULE_NOT_FOUND`。
- `--no-open`、`--port` 都是 `dsh-web-app` 声明过的真实参数（`lib/startup.js`）。
- 服务端 stdout/stderr 重定向到 `logs\dsh-web-server.log` / `.err.log`，便于排障。
- 任何失败都**弹可见提示框**（`WScript.Shell.Popup`），而不是在最小化窗口里 `Read-Host`
  ——后者用户根本看不到，等价于静默失败。
- `-DiscoverOnly` 只做"发现运行时并写回配置"，不启动任何进程（安装脚本会调用它）。

## 5. 桌面宿主

- 二进制：`dsh-desktop.exe`（Tauri 2，约 5 MB），落在
  `%DSH_HOME%\desktop-host\win32-x64\`，来源 GitHub Release `YUEEEEY/dsh-desktop-host`。
- 启动契约：`--url http://127.0.0.1:<port> --home <DSH_HOME>`。
- 它提供系统托盘（显示/隐藏、环境面板、代码编辑器、重启服务、开机自启等）与桌面窗口；
  `dsh-desktop-tools` 在服务就绪约 2.5s 后自动拉起它（`autoOpenDesktop`，默认开）。
- 手工安装后要让 `/api/desktop` 认为"就绪"，需同时写 `ensure-status.json`（`state: "ready"`）
  与 `VERSION`。

## 6. 文件与目录约定

```
<root>/
├── SKILL.md                      skill 入口（frontmatter + 流程）
├── launch-dsh.ps1                启动逻辑（发现运行时 / 探活 / 打开界面）
├── install-into-dsh.ps1          装插件 + 宿主 + 记录运行时（幂等）
├── install-desktop-shortcut.ps1  建桌面快捷方式（幂等）
├── uninstall-from-dsh.ps1        完整回滚
├── 启动 DeepSeek Harness.cmd      双击入口的 .cmd 垫片
├── launch-config.json            运行配置（不含任何密钥）
├── assets/                       官方鲸鱼路径 / 官方 svg / 生成好的 .ico 与 png
├── build/                        可复现的生成与自检脚本
├── plugin/dsh-whale-widget/      插件包（src 与生成好的 lib）
└── references/                   本文档与其它说明
```

`.ps1` 在根、`build/*.cjs` 在下一层，二者都用自身位置定位根（`$PSScriptRoot` / `__dirname`），
**不写死任何本机绝对路径**——这是能打包给别人用的前提。
