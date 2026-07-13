# nnresume

本地优先的简历编辑器：结构化内容、实时 A4 预览、多模板渲染、Git 版本和私有远程同步。

## 快速开始

环境要求：Node.js 20+、Git。PDF/PNG 导出首次需要安装 Chromium。

```bash
npx playwright install chromium
npx nnresume init my-resume --default
npx nnresume
```

初始化命令会创建独立工作区、执行 `git init -b main` 和初始提交，并优先通过已登录的 GitHub CLI 创建私有仓库。`--default` 会把该目录保存为默认工作区，之后可以在任意目录运行 `npx nnresume`。默认仓库名等于初始化目录名，例如 `npx nnresume init my-resume` 会创建 `<当前 GitHub 账号>/my-resume`；也可通过 `--repo owner/name` 指定。GitHub 仓库使用工作区级 HTTPS 凭证配置，不修改全局 Git 设置。未安装或未登录 `gh` 时，可以粘贴任意 Git 远程 URL。

已有工作区在新设备上的使用方式：

```bash
git clone <private-repository-url>
npx nnresume default <repository-directory>
npx nnresume
```

服务只监听 `127.0.0.1`，默认打开 <http://127.0.0.1:4173>。

## CLI

```bash
nnresume init [directory] [--default] [--repo owner/name | --remote url]
nnresume [directory] [--port 4173] [--no-open] [--background]
nnresume start [directory] [--port 4173] [--no-open] [--background]
nnresume export [directory] --label backend-v2
nnresume default [directory | --clear]
nnresume doctor [directory]
```

未传工作区目录时，nnresume 先使用当前目录中的工作区；当前目录不是工作区时，再使用默认工作区。因此进入其他简历工作区后仍可直接运行 `nnresume`，不会被全局默认值覆盖。显式传入目录始终优先。需要释放当前终端时，可运行 `nnresume --background` 将编辑器留在后台。

```bash
# 设置或替换默认工作区
nnresume default /path/to/my-resume

# 查看当前默认值
nnresume default

# 清除默认值
nnresume default --clear
```

默认值只保存工作区的绝对路径，不包含简历内容。配置文件位于 `~/.config/nnresume/config.json`；Windows 使用 `%APPDATA%\nnresume\config.json`，设置了 `XDG_CONFIG_HOME` 时会遵循该目录。

## 工作区

```text
my-resume/
├── resume.json       # 内容与 template ID
├── assets/           # 个人照片等受控资源
├── exports/          # PDF/PNG/HTML，本地忽略
├── .gitignore
└── README.md
```

- 保存配置不会自动创建 Git commit。
- 个人照片可在“基本信息”中直接选择并导入，也可手动填写受控的 `assets/...` 路径。
- “创建 Git 版本”只提交 `resume.json` 和 `assets/`，不会暂存其他文件。
- 推送是独立动作；远程拉取只允许干净工作区和 fast-forward，不自动解决冲突。
- 内置 `classic` 经典单栏和 `modern` 现代双栏模板，同一份内容可即时切换。

## 开发

```bash
npm ci
npx playwright install chromium
npm run dev
npm run check
npm test
npm run test:e2e
npm run pack:check
```

`examples/demo` 仅含虚构数据。npm 发布由 `files` 白名单和包内容审计共同保护，真实简历、头像和导出物不会进入 tarball。

## License

MIT
