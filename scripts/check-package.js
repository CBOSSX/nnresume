const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const cache = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-npm-cache-"));
const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, NPM_CONFIG_CACHE: cache },
});
const report = JSON.parse(output)[0];
const names = report.files.map((file) => file.path);
const forbiddenPaths = [
  /^assets\//,
  /^examples\//,
  /^exports\//,
  /^test\//,
  /^scripts\//,
  /^resume\.json$/,
  /profile\.(png|jpe?g|webp)$/i,
];
names.forEach((name) => {
  if (forbiddenPaths.some((pattern) => pattern.test(name))) throw new Error(`发布包包含禁止路径：${name}`);
});
if (!names.includes("bin/nnresume.js") || !names.includes("starter/resume.json") || !names.includes("starter/gitignore")) {
  throw new Error("发布包缺少 CLI 或 starter 文件");
}
process.stdout.write(`Package audit passed: ${names.length} files, ${report.size} bytes.\n`);
