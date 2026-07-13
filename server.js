const fs = require("fs");
const http = require("http");
const path = require("path");
const { storeProfilePhoto } = require("./lib/assets");
const { readConfig, validateConfig, writeConfigAtomic } = require("./lib/config");
const { commitChanges, fetchRemote, getGitStatus, pullRemote, pushRemote } = require("./lib/git");
const { listTemplates, readTemplate } = require("./lib/templates");
const {
  createBackupSnapshot,
  exportResume,
  getExportPaths,
  isSafeExportId,
  listExports,
  readExport,
} = require("./lib/exporter");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const STATIC_FILES = new Set([
  "index.html",
  "editor.css",
  "editor.js",
  "nnresume-logo.png",
  "preview.html",
  "resume-renderer.js",
]);
const EXPORT_FILES = new Set(["resume.pdf", "resume.png", "resume.json", "resume.html", "manifest.json"]);

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function sendFile(response, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    sendJson(response, 404, { error: "文件不存在" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(file).pipe(response);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        const error = new Error("请求体过大");
        error.statusCode = 413;
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        const error = new Error("JSON 格式不正确");
        error.statusCode = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function readBinaryBody(request, limit = MAX_ASSET_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("图片不能超过 5 MB");
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function createServer(options = {}) {
  const appRoot = options.appRoot || __dirname;
  const workspaceRoot = options.workspaceRoot || options.root || __dirname;
  const validateTemplate = (config) => readTemplate(appRoot, config.template);
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);

      if (request.method === "GET" && pathname === "/api/config") {
        return sendJson(response, 200, readConfig(workspaceRoot));
      }
      if (request.method === "GET" && pathname === "/api/schema") {
        return sendFile(response, path.join(appRoot, "resume.schema.json"));
      }
      if (request.method === "GET" && pathname === "/api/templates") {
        return sendJson(response, 200, listTemplates(appRoot));
      }
      if (request.method === "PUT" && pathname === "/api/config") {
        const body = await readJsonBody(request);
        const validation = validateConfig(body);
        if (!validation.valid) return sendJson(response, 400, { error: "配置校验失败", errors: validation.errors });
        validateTemplate(body);
        return sendJson(response, 200, writeConfigAtomic(workspaceRoot, body));
      }
      if (request.method === "PUT" && pathname === "/api/assets/photo") {
        const body = await readBinaryBody(request);
        if (!body.length) return sendJson(response, 400, { error: "请选择要导入的图片" });
        return sendJson(response, 201, storeProfilePhoto(workspaceRoot, body, request.headers["content-type"]));
      }
      if (request.method === "POST" && pathname === "/api/exports") {
        const body = await readJsonBody(request);
        const validation = validateConfig(body.config);
        if (!validation.valid) return sendJson(response, 400, { error: "配置校验失败", errors: validation.errors });
        validateTemplate(body.config);
        const saved = writeConfigAtomic(workspaceRoot, body.config);
        const manifest = await exportResume({ appRoot, workspaceRoot, config: saved, label: body.label });
        return sendJson(response, 201, manifest);
      }
      if (request.method === "GET" && pathname === "/api/exports") {
        return sendJson(response, 200, listExports(workspaceRoot));
      }
      if (request.method === "GET" && pathname === "/api/git/status") {
        return sendJson(response, 200, getGitStatus(workspaceRoot));
      }
      if (request.method === "POST" && pathname === "/api/git/commit") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, commitChanges(workspaceRoot, body.message));
      }
      if (request.method === "POST" && pathname === "/api/git/fetch") {
        return sendJson(response, 200, fetchRemote(workspaceRoot));
      }
      if (request.method === "POST" && pathname === "/api/git/push") {
        return sendJson(response, 200, pushRemote(workspaceRoot));
      }
      if (request.method === "POST" && pathname === "/api/git/pull") {
        return sendJson(response, 200, pullRemote(workspaceRoot));
      }

      const exportApiMatch = pathname.match(/^\/api\/exports\/([^/]+)$/u);
      if (request.method === "GET" && exportApiMatch) {
        return sendJson(response, 200, readExport(workspaceRoot, exportApiMatch[1]));
      }
      const restoreMatch = pathname.match(/^\/api\/exports\/([^/]+)\/restore$/u);
      if (request.method === "POST" && restoreMatch) {
        const id = restoreMatch[1];
        const target = readExport(workspaceRoot, id);
        const current = readConfig(workspaceRoot);
        const backup = createBackupSnapshot({ root: workspaceRoot, config: current, label: `before-restore-${id}` });
        validateTemplate(target.config);
        const restored = writeConfigAtomic(workspaceRoot, target.config);
        return sendJson(response, 200, { config: restored, backup });
      }

      const exportFileMatch = pathname.match(/^\/exports\/([^/]+)\/([^/]+)$/u);
      if (request.method === "GET" && exportFileMatch) {
        const [, id, fileName] = exportFileMatch;
        if (!isSafeExportId(id) || !EXPORT_FILES.has(fileName)) return sendJson(response, 400, { error: "路径不合法" });
        return sendFile(response, path.join(getExportPaths(workspaceRoot, id).directory, fileName));
      }

      const assetMatch = pathname.match(/^\/assets\/([\w.-]+\.(?:png|jpe?g|webp))$/i);
      if (request.method === "GET" && assetMatch) {
        return sendFile(response, path.join(workspaceRoot, "assets", assetMatch[1]));
      }

      const templateMatch = pathname.match(/^\/templates\/([a-z][a-z0-9-]{0,39})\/(styles\.css|renderer\.js)$/u);
      if (request.method === "GET" && templateMatch) {
        const template = readTemplate(appRoot, templateMatch[1]);
        const file = templateMatch[2] === "styles.css" ? template.stylesPath : template.rendererPath;
        return sendFile(response, file);
      }

      if (request.method === "GET") {
        const fileName = pathname === "/" ? "index.html" : pathname.slice(1);
        if (STATIC_FILES.has(fileName)) return sendFile(response, path.join(appRoot, fileName));
      }
      return sendJson(response, 404, { error: "接口不存在" });
    } catch (error) {
      return sendJson(response, error.statusCode || 500, {
        error: error.message || "服务器错误",
        errors: error.validationErrors,
      });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  const workspaceRoot = path.resolve(process.env.NNRESUME_WORKSPACE || process.cwd());
  const server = createServer({ appRoot: __dirname, workspaceRoot });
  server.listen(port, "127.0.0.1", () => {
    console.log(`nnresume: http://127.0.0.1:${port}`);
  });
}

module.exports = { createServer, readBinaryBody, readJsonBody };
