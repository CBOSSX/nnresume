const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { clone, validateConfig } = require("./config");
const { getGitStatus } = require("./git");
const { readTemplate } = require("./templates");

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function sanitizeLabel(label) {
  const value = String(label || "resume")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return value || "resume";
}

function createExportId(exportsRoot, label, now = new Date()) {
  const timestamp = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join("")
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  const base = `${timestamp}_${sanitizeLabel(label)}`;
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(path.join(exportsRoot, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function isSafeExportId(value) {
  return typeof value === "string" && value.length <= 120 && /^[\p{L}\p{N}_.-]+$/u.test(value);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fileMetadata(file) {
  return { bytes: fs.statSync(file).size, sha256: sha256File(file) };
}

function inlinePhoto(workspaceRoot, input) {
  const config = clone(input);
  const photo = config.basics?.photo;
  if (!photo || photo.startsWith("data:")) return config;
  if (!/^assets\/[\w.-]+\.(png|jpe?g|webp)$/i.test(photo)) return config;
  const file = path.join(workspaceRoot, photo);
  if (!fs.existsSync(file)) return config;
  const extension = path.extname(file).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  config.basics.photo = `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
  return config;
}

function normalizeBuildArguments(rootOrOptions, configArg) {
  if (typeof rootOrOptions === "string") {
    return { appRoot: rootOrOptions, workspaceRoot: rootOrOptions, config: configArg };
  }
  return rootOrOptions;
}

function buildSelfContainedHtml(rootOrOptions, configArg) {
  const { appRoot, workspaceRoot, config } = normalizeBuildArguments(rootOrOptions, configArg);
  const template = readTemplate(appRoot, config.template);
  const shell = fs.readFileSync(path.join(appRoot, "preview.html"), "utf8");
  const loader = fs.readFileSync(path.join(appRoot, "resume-renderer.js"), "utf8");
  const styles = fs.readFileSync(template.stylesPath, "utf8");
  const renderer = fs.readFileSync(template.rendererPath, "utf8");
  const serialized = JSON.stringify(inlinePhoto(workspaceRoot, config)).replace(/<\/script/gi, "<\\/script");
  const manifest = JSON.stringify(template.manifest).replace(/<\/script/gi, "<\\/script");
  return shell
    .replace(/\s*<link id="template-style" rel="stylesheet" href="" \/>/, `\n    <style>${styles}</style>`)
    .replace(/\s*<script src="resume-renderer\.js" defer><\/script>/, "")
    .replace("</body>", `<script>window.__RESUME_CONFIG__=${serialized};window.__NNRESUME_TEMPLATE__=${manifest};</script><script>${renderer}</script><script>${loader}</script></body>`);
}

function getExportPaths(root, id) {
  if (!isSafeExportId(id)) {
    const error = new Error("导出 ID 不合法");
    error.statusCode = 400;
    throw error;
  }
  const exportsRoot = path.join(root, "exports");
  const directory = path.join(exportsRoot, id);
  if (path.dirname(directory) !== exportsRoot) throw new Error("导出路径不合法");
  return { exportsRoot, directory };
}

async function exportResume({ root, appRoot = root, workspaceRoot = root, config: input, label = "resume" }) {
  const config = clone(input);
  const validation = validateConfig(config);
  if (!validation.valid) {
    const error = new Error("配置校验失败");
    error.statusCode = 400;
    error.validationErrors = validation.errors;
    throw error;
  }
  const template = readTemplate(appRoot, config.template);
  const exportsRoot = path.join(workspaceRoot, "exports");
  fs.mkdirSync(exportsRoot, { recursive: true });
  const id = createExportId(exportsRoot, label);
  const directory = path.join(exportsRoot, id);
  fs.mkdirSync(directory);
  const configPath = path.join(directory, "resume.json");
  const htmlPath = path.join(directory, "resume.html");
  const pdfPath = path.join(directory, "resume.pdf");
  const pngPath = path.join(directory, "resume.png");

  let browser;
  try {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    fs.writeFileSync(htmlPath, buildSelfContainedHtml({ appRoot, workspaceRoot, config }));
    const { chromium } = require("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1.5 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle" });
    await page.locator(".page").waitFor();
    const layout = await page.locator(".page").evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflow: node.scrollHeight > node.clientHeight,
    }));
    if (layout.overflow) {
      const error = new Error(`简历超出 A4：${layout.scrollHeight}px > ${layout.clientHeight}px`);
      error.statusCode = 422;
      throw error;
    }
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    await page.emulateMedia({ media: "screen" });
    await page.locator(".page").screenshot({ path: pngPath });
    await browser.close();
    browser = null;

    const git = getGitStatus(workspaceRoot);
    const manifest = {
      kind: "export",
      id,
      label: sanitizeLabel(label),
      exportedAt: new Date().toISOString(),
      schemaVersion: config.schemaVersion,
      template: { id: template.manifest.id, version: template.manifest.version },
      configSha256: crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex"),
      git: { branch: git.branch, commit: git.commit, shortCommit: git.shortCommit, dirty: git.dirty },
      document: { pageCount: 1, pageSize: "A4", overflow: false },
      files: {
        "resume.pdf": fileMetadata(pdfPath),
        "resume.png": fileMetadata(pngPath),
        "resume.json": fileMetadata(configPath),
        "resume.html": fileMetadata(htmlPath),
      },
    };
    fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function createBackupSnapshot({ root, config, label = "before-restore" }) {
  const exportsRoot = path.join(root, "exports");
  fs.mkdirSync(exportsRoot, { recursive: true });
  const id = createExportId(exportsRoot, label);
  const directory = path.join(exportsRoot, id);
  fs.mkdirSync(directory);
  const configPath = path.join(directory, "resume.json");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const git = getGitStatus(root);
  const manifest = {
    kind: "restore-backup",
    id,
    label: sanitizeLabel(label),
    exportedAt: new Date().toISOString(),
    schemaVersion: config.schemaVersion,
    template: { id: config.template },
    configSha256: crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex"),
    git: { branch: git.branch, commit: git.commit, shortCommit: git.shortCommit, dirty: git.dirty },
    files: { "resume.json": fileMetadata(configPath) },
  };
  fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function listExports(root) {
  const exportsRoot = path.join(root, "exports");
  if (!fs.existsSync(exportsRoot)) return [];
  return fs.readdirSync(exportsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isSafeExportId(entry.name))
    .map((entry) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(exportsRoot, entry.name, "manifest.json"), "utf8"));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right.exportedAt).localeCompare(String(left.exportedAt)));
}

function readExport(root, id) {
  const { directory } = getExportPaths(root, id);
  if (!fs.existsSync(directory)) {
    const error = new Error("导出记录不存在");
    error.statusCode = 404;
    throw error;
  }
  return {
    manifest: JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")),
    config: JSON.parse(fs.readFileSync(path.join(directory, "resume.json"), "utf8")),
  };
}

module.exports = {
  buildSelfContainedHtml,
  createBackupSnapshot,
  createExportId,
  exportResume,
  getExportPaths,
  isSafeExportId,
  listExports,
  readExport,
  sanitizeLabel,
};
