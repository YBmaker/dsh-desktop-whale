# assets（本目录内容不入库）

本目录只存放**在本机生成**的图标与官方路径副本，.gitignore 已忽略它们。

在目标机器上按顺序执行即可生成：

```powershell
cd ..\build
node provenance-check.cjs   # 从本机 DSH 安装提取官方鲸鱼路径，并自证来源
node build-icons.cjs        # 生成 deepseek-whale.ico（7 档尺寸）等图标
```n