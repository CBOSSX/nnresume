# My Resume

这是一个由 [nnresume](https://github.com/CBOSSX/nnresume) 创建的私有简历工作区。

nnresume 是本地优先的简历编辑器：在浏览器中编辑结构化内容、实时检查 A4 排版、切换模板，并导出 PDF、PNG 和 HTML。简历内容、个人照片和 Git 历史都保存在这个仓库中；应用服务只监听本机 `127.0.0.1`。

## 快速使用

环境要求：Node.js 20+、Git。首次导出前还需要安装 Playwright Chromium。

```bash
# 克隆此私有仓库后，在工作区目录内执行
npx playwright install chromium
npx nnresume
```

浏览器打开后：

1. 在“编辑”页填写内容；个人照片可在“基本信息”中选择并导入。
2. 点击“保存配置”，将内容写入 `resume.json`。
3. 点击“导出版本”，生成 PDF、PNG、HTML 和配置快照。
4. 在“Git”页创建版本并推送，或继续使用熟悉的 Git 命令。

也可以直接从命令行导出：

```bash
npx nnresume export --label latest
```

## 工作区文件

- `resume.json`：唯一内容来源与模板选择。
- `assets/`：个人照片等受控资源。
- `exports/`：本地导出物，不进入 Git。

“创建 Git 版本”只会暂存 `resume.json` 和 `assets/`。请保持仓库为私有，不要把真实简历、照片或导出文件提交到 nnresume 产品仓库。

完整说明、问题反馈和版本更新见 [nnresume GitHub 仓库](https://github.com/CBOSSX/nnresume)。
