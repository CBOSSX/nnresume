const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { readConfig, validateConfig } = require("./config");

const WORKSPACE_FILES = ["resume.json", "assets", ".gitignore", "README.md"];

function assertEmptyTarget(target) {
  if (!fs.existsSync(target)) return;
  if (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length > 0) {
    const error = new Error(`目标目录必须为空：${target}`);
    error.statusCode = 409;
    throw error;
  }
}

function assertWorkspace(root) {
  const resolved = path.resolve(root);
  const configPath = path.join(resolved, "resume.json");
  if (!fs.existsSync(configPath)) {
    const error = new Error(`不是 nnresume 工作区，缺少 resume.json：${resolved}`);
    error.statusCode = 400;
    throw error;
  }
  const validation = validateConfig(readConfig(resolved));
  if (!validation.valid) {
    const error = new Error("工作区配置校验失败");
    error.statusCode = 400;
    error.validationErrors = validation.errors;
    throw error;
  }
  return resolved;
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  fs.readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  });
}

function createWorkspace({ appRoot, target }) {
  const resolved = path.resolve(target);
  assertEmptyTarget(resolved);
  fs.mkdirSync(resolved, { recursive: true });
  copyDirectory(path.join(appRoot, "starter"), resolved);
  const packagedGitignore = path.join(resolved, "gitignore");
  if (fs.existsSync(packagedGitignore)) fs.renameSync(packagedGitignore, path.join(resolved, ".gitignore"));
  return assertWorkspace(resolved);
}

function initializeRepository(root) {
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["add", "--", ...WORKSPACE_FILES], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "chore: initialize resume workspace"], { cwd: root, stdio: "pipe" });
}

module.exports = { WORKSPACE_FILES, assertWorkspace, createWorkspace, initializeRepository };
