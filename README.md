# dsh-desktop-whale

给 **DeepSeek Harness (DSH)** 加两样东西：

- 🐋 **桌面启动入口**：桌面上一个双击即用的图标，用 **DeepSeek 官方大鲸鱼**做图标；
  服务没跑就起来，已经在跑就直接把界面开出来。
- 🐋 **小鲸鱼挂件**：界面右下角常驻的小鲸鱼按钮，点一下展开 **DeepSeek 账户余额 +
  token 用量 + 估算花费**，展开时每 60 秒自动刷新。

同时，它也是一份 **DSH Skill**：把整套做法（含全部踩坑与验证方法）写成可复用的指令，
让 AI 能在别的机器上重做一遍，而不是靠口口相传。

A desktop launcher with the official DeepSeek whale icon, plus a floating whale widget
showing account balance and token usage — packaged as a reusable DSH Skill.

---

## 它长什么样

> 下方面板里的数字**全部是示意值**，不是任何真实账户数据。

```
桌面：DeepSeek Harness.lnk（大鲸鱼）
   └─ 双击 → 探活 3080 →（没跑就起 dsh web）→ 打开界面

界面：右下角常驻小鲸鱼按钮
   └─ 点一下 → ┌──────────────────────────┐
               │ 🐋 DeepSeek 余额          │
               │ ¥ <账户余额>              │
               │ 账户可用 · CNY            │
               │ 赠金        ¥ <赠金>      │
               │ 充值余额    ¥ <充值>      │
               │ 估算花费    ¥ <估算>      │
               │ ─────────────────────    │
               │ 输入 tokens   <数字>      │
               │ 输出 tokens   <数字>      │
               │ 缓存读取      <数字>      │
               │ 会话数        <数字>      │
               │ 更新于 HH:MM:SS   [刷新]  │
               └──────────────────────────┘
```

## 安全：不碰你的 API Key

```
挂件（浏览器）─fetch('/whale/billing')→ 插件 Host 半边
                                        └─GET /api/billing→ 已有计费源（Key 在此）
```

- API Key 始终留在 DSH 进程内，浏览器与任何外部小程序都拿不到；
- Host 半边**只下发要显示的叶子字段**，不透传整个上游对象；
- 上游不可用时显示"暂不可用"+原因，**不显示假数据**。

## 快速开始

```powershell
# 0) 先只做侦察，确认 dsh 是否真的能从"普通用户进程"看到
([Environment]::GetEnvironmentVariable('Path','Machine')) -split ';'

# 1) 生成官方鲸鱼图标（会先自证来源）
cd build
node provenance-check.cjs     # favicon 与官方 FISH_LOGO_PATH 是否同一标记（IoU≈0.976）
node build-icons.cjs          # 生成 assets\deepseek-whale.ico（7 档尺寸）
node verify-ico.cjs           # 逐条校验 ICO 结构
cd ..

# 2) 装进 DSH（幂等；需要写 %DSH_HOME%，可能触发一次权限确认）
powershell -ExecutionPolicy Bypass -File install-into-dsh.ps1

# 3) 桌面快捷方式（大鲸鱼图标）
powershell -ExecutionPolicy Bypass -File install-desktop-shortcut.ps1

# 4)（可选）补上桌面宿主，拿到原生窗口 + 系统托盘
node build\download-host2.cjs
powershell -ExecutionPolicy Bypass -File install-into-dsh.ps1
```

装完**刷新一次界面**即可看到挂件（DSH 的客户端模块图是增量扫描的，不需要重启 DSH）。

回滚：

```powershell
powershell -ExecutionPolicy Bypass -File uninstall-from-dsh.ps1
```

## 目录

| 路径 | 说明 |
|---|---|
| `SKILL.md` | **Skill 入口**：完整流程、硬约束、排障速查 |
| `references/pitfalls.md` | 10 个踩过的坑与根因（最值钱的一页） |
| `references/architecture.md` | 数据链路、插件双半边、Slot/样式、启动行为矩阵 |
| `references/verification.md` | 可复制的验证命令与判据 |
| `launch-dsh.ps1` | 启动逻辑：发现运行时 → 探活 → 打开界面 |
| `install-into-dsh.ps1` / `uninstall-from-dsh.ps1` | 安装 / 完整回滚（幂等） |
| `install-desktop-shortcut.ps1` | 建桌面快捷方式（幂等） |
| `build/` | 生成与自检脚本（图标 / 插件 / 宿主 / 验证） |
| `plugin/dsh-whale-widget/` | 挂件插件包（Host + 浏览器双半边） |
| `assets/` | 官方鲸鱼路径、官方 svg、生成好的 ico/png |

## 三个最关键的约束

1. **动态 Cordis 插件读不到本机路由** —— Host 侧 `web.fetch` 拒绝非公网 IP
   (`WEB_BLOCKED_URL`)，Client 侧动态沙箱没有 `fetch`。所以挂件必须是**持久化真实插件**。
2. **`dsh` 常常不在用户的持久 PATH 里** —— 你能在 DSH 会话里找到它，是因为继承了 DSH 进程的
   环境；桌面双击的进程看不到。启动入口必须自己发现运行时。
3. **`.ps1` 必须带 UTF-8 BOM** —— 否则 Windows PowerShell 5.1 按 GBK 解析，中文直接变语法错误。

（每条都有可复现现象与修法，见 `references/pitfalls.md`。）

## 仓库内容边界（隐私）

本仓库**只包含代码与文档**，不含任何从某台机器提取或生成的文件：

- **0 个二进制**（无 `.ico` / `.png` / `.exe` / `.dll` / `.zip`）；
- 官方鲸鱼路径与 favicon 在**目标机器上现取**（`build/provenance-check.cjs`）；
- 图标在**目标机器上现生成**（`build/build-icons.cjs`）；
- `launch-config.json` 含本机路径，属"安装产物"，不入库，由 `launch-dsh.ps1 -DiscoverOnly` 现场创建；
- 机器专属标识清单放在工具目录的 `.privacy-deny`，**不在本仓库内**。

**唯一例外（已确认保留）**：`plugin/dsh-whale-widget/lib/client.js` 内联了一段 3448 字符的
官方 `FISH_LOGO_PATH`（鲸鱼图形本身），已逐字节核验等于 DSH 官方前端 bundle 里的同名常量。
它让挂件无需额外素材即可渲染鲸鱼，属产品品牌素材。
## 依赖

- Windows（启动入口与 `.ico` 部分）；插件本身跨平台。
- 一个可用的 DSH 安装（Web profile 能跑）。
- Node.js（生成图标与插件时用；宿主下载脚本也用它）。
- `sharp`（生成图标用；脚本会在 `%DSH_HOME%/profiles/*/node_modules` 里自动找，找不到再 `npm i sharp`）。
- 计费数据来源：`dsh-desktop-tools` 插件（提供 `GET /api/billing`）。
- 桌面宿主二进制来自 [YUEEEEY/dsh-desktop-host](https://github.com/YUEEEEY/dsh-desktop-host) Releases，
  本仓库**不附带**该二进制。

## 许可

MIT（见 `LICENSE`）。鲸鱼图形取自 DSH 官方发行物，非自绘，来源与证据链见 `LICENSE` 与
`build/provenance-check.cjs`。
