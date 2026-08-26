<a name="readme-top"></a>

<div align="center">

<img src="https://raw.githubusercontent.com/sultanofcardio/idea-git/main/images/assets/logo-128.png" width="88" alt="IDEA Git 图标" />

<h1>IDEA Git</h1>

**换到 VS Code，不必重学 Git 工作流。**

为熟悉 JetBrains Git 工作流、正在迁移到 **VS Code** 或 **Cursor** 的开发者打造。

[English](./README.md) · **简体中文**

</div>

---

IDEA Git 将你在 JetBrains IDE 中已经熟悉的 Git 使用习惯带到新编辑器：可视化分支树、紧凑提交图、独立 Commit 工具窗口、Shelf 与 Stash、分支比较、历史改写、Merge 与冲突处理。更换编辑器之后，不需要从头适应另一套工作流。

> IDEA Git 是独立开源项目，与 JetBrains、Microsoft、GitHub 或 Cursor 不存在隶属、赞助或官方合作关系。

> 本项目 Fork 自 [VitalHex/branchshift](https://github.com/VitalHex/branchshift)。原仓库及其贡献者信息完整保留在[项目沿革](#项目沿革)中。

## 熟悉的工作流，新的编辑器

| JetBrains 中的习惯 | IDEA Git 在 VS Code 中的对应能力 |
| --- | --- |
| Commit 工具窗口 | 独立 Commit 侧栏，支持部分提交、Amend、Commit & Push、Shelf 与 Stash |
| Git Log | 分支树、紧凑提交图、Refs、过滤器、Changed Files 与提交详情 |
| Compare with Current | 独立双向比较标签页，两侧分别拥有完整过滤器 |
| 分支操作 | Checkout、Update、Push、Merge、Rebase、Rename、Delete、Favorite 等 |
| 合并冲突 | 冲突面板与带语法高亮的三路合并编辑器 |
| 多仓库项目 | Multi-root workspace 下 Commit 与 Git Log 共享同一活动仓库 |

## 核心能力

### Git Log 与分支管理

- 可搜索的本地分支、远程分支与 Tag 树
- 收藏、ahead/behind 指示与基于 upstream 的安全 Update
- 彩色提交图，可调整或隐藏提交信息列
- 按分支、作者、日期和文件历史过滤
- 普通日志与比较日志复用同一套提交右键操作

### Commit、Shelf 与 Stash

- 按文件勾选，支持部分提交
- Commit、Commit and Push 与 Amend
- 目录分组、多选、Rollback 和 Diff 文件导航
- 使用 `.idea/shelf/` 保存与 JetBrains 兼容的 Shelf 数据
- 原生 Git Stash 管理

### 分支比较

将本地分支、远程分支或 Tag 与当前分支比较。IDEA Git 会打开独立编辑器标签页，分别展示两侧独有提交，并提供独立过滤器、Changed Files 和提交详情。

### 符合直觉的右键菜单

在分支、提交与变更文件上右键，即可执行 Checkout、Cherry-Pick、Reset、Revert、Merge、Rebase、Diff、文件历史和源码跳转等与仓库绑定的操作。

### 冲突处理与三路合并

- 独立冲突列表，支持 Accept Yours、Accept Theirs 与 Merge
- Theirs / Result / Yours 三栏编辑器
- 逐冲突块操作与语法高亮
- 与 VS Code 内置 Source Control 面板集成

### Multi-root workspace

IDEA Git 当前从每个 workspace folder 发现一个 Git 仓库，并在 Commit 与 Git Log 中提供共享的活动仓库选择器。单个顶层文件夹内部存在多个嵌套 Git 仓库的场景将在后续版本中支持。

## 安装

> 如果你安装过 JetGit Plus 开发版 VSIX，请先卸载 `strNewBee.jetgit-plus`。IDEA Git 使用新的扩展 ID `sultanofcardio.idea-git`，VS Code 会将两者视为不同扩展。

### VS Code Marketplace

在扩展面板中搜索 **IDEA Git** 或 **Git**。

### VSIX

1. 从 [Releases](https://github.com/sultanofcardio/idea-git/releases) 下载最新 `.vsix`。
2. 在命令面板运行 **Extensions: Install from VSIX...**。

## 环境要求

- VS Code 1.85.0 或更高版本
- Git 已安装并可以通过 `PATH` 调用

## 本地开发

```bash
git clone https://github.com/sultanofcardio/idea-git.git
cd idea-git
pnpm install
cd webview && pnpm install && cd ..
```

按 **F5** 启动 Extension Development Host。

```bash
pnpm run watch          # 开发监听模式
pnpm run build          # 构建 Extension Host 与 Webview
pnpm run vsce:package   # 生成 VSIX 安装包
```

## 项目沿革

IDEA Git Fork 自 [VitalHex/branchshift](https://github.com/VitalHex/branchshift)，并保留原项目的 Git Graph 与合并能力基础。本 Fork 后续增加了 JetBrains 风格的 Commit/Shelf/Stash 工作流、丰富的右键操作、分支比较、Multi-root 多仓库支持以及独立品牌。

部分界面图标来自 [IntelliJ Platform Icons](https://intellij-icons.jetbrains.design/)，遵循 Apache 2.0 许可证。IDEA Git 应用图标为本项目原创资产。

## 许可证

IDEA Git 继续使用 [MIT License](./LICENSE)，并保留两个上游项目的版权声明。

打包扩展中包含的第三方素材（JetBrains 图标、Visual Studio Code Codicons，以及所有被打包的 npm 依赖）及其所需的声明，统一列于扩展包内的 `THIRD-PARTY-NOTICES.md`。MIT 与 Apache 2.0 许可证均不授予商标权；IDEA Git 与 JetBrains、Microsoft、GitHub、Cursor 无从属或背书关系。
