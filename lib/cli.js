const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { execFile, execFileSync } = require("child_process");
const { createServer } = require("../server");
const { readConfig, validateConfig } = require("./config");
const { exportResume } = require("./exporter");
const { addRemote, fetchRemote, pushRemote } = require("./git");
const { clearDefaultWorkspace, getSettingsPath, readDefaultWorkspace, setDefaultWorkspace } = require("./settings");
const { assertWorkspace, createWorkspace, initializeRepository } = require("./workspace");

function parseArguments(argv) {
  const values = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      values.push(value);
      continue;
    }
    const [key, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      flags[key] = argv[index + 1];
      index += 1;
    } else flags[key] = true;
  }
  return { values, flags };
}

function commandExists(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch (_) {
    return false;
  }
}

function ghAuthenticated() {
  try {
    execFileSync("gh", ["auth", "status", "-h", "github.com"], { stdio: "ignore", timeout: 10000 });
    return true;
  } catch (_) {
    return false;
  }
}

function createGitHubRepository(root, repository) {
  execFileSync("gh", ["repo", "create", repository, "--private", "--source", root, "--remote", "origin"], {
    cwd: root,
    stdio: "inherit",
    timeout: 120000,
  });
  const url = execFileSync("gh", ["repo", "view", repository, "--json", "url", "--jq", ".url"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 30000,
  }).trim();
  execFileSync("git", ["remote", "set-url", "origin", `${url}.git`], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "--local", "credential.https://github.com.helper", "!gh auth git-credential"], { cwd: root, stdio: "pipe" });
  pushRemote(root);
}

async function promptRemote(root, preferredRepository) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (commandExists("gh") && ghAuthenticated()) {
      const answer = (await prompt.question(`创建 GitHub 私有仓库 ${preferredRepository}？[Y/n] `)).trim().toLowerCase();
      if (!answer || answer === "y" || answer === "yes") {
        const repository = (await prompt.question(`仓库名称 [${preferredRepository}]：`)).trim() || preferredRepository;
        createGitHubRepository(root, repository);
        return true;
      }
    } else {
      process.stdout.write("GitHub CLI 未登录。可先运行 gh auth login，或在下面粘贴已创建的私有仓库 URL。\n");
    }
    const remote = (await prompt.question("origin URL（暂时跳过可留空）：")).trim();
    if (!remote) return false;
    addRemote(root, remote);
    pushRemote(root);
    return true;
  } finally {
    prompt.close();
  }
}

function resolveWorkspace(directory, options = {}) {
  if (directory) return assertWorkspace(directory);
  const cwd = path.resolve(options.cwd || process.cwd());
  if (fs.existsSync(path.join(cwd, "resume.json"))) return assertWorkspace(cwd);
  const defaultWorkspace = readDefaultWorkspace(options);
  if (defaultWorkspace) {
    try {
      return assertWorkspace(defaultWorkspace);
    } catch (error) {
      throw new Error(`${error.message}\n默认工作区已失效，请运行 nnresume default <directory> 更新，或运行 nnresume default --clear 清除。`);
    }
  }
  throw new Error(`未找到 nnresume 工作区。请传入目录，或运行 nnresume default <directory> 设置默认工作区。当前目录：${cwd}`);
}

async function initCommand(appRoot, argv, options = {}) {
  const { values, flags } = parseArguments(argv);
  const target = createWorkspace({ appRoot, target: values[0] || "my-resume" });
  initializeRepository(target);
  const repository = String(flags.repo || path.basename(target));
  let remoteConfigured = false;
  if (flags.remote) {
    addRemote(target, String(flags.remote));
    pushRemote(target);
    remoteConfigured = true;
  } else if (flags.repo) {
    if (!commandExists("gh") || !ghAuthenticated()) {
      throw new Error("--repo 需要已登录的 GitHub CLI，请先运行 gh auth login");
    }
    createGitHubRepository(target, repository);
    remoteConfigured = true;
  } else if (!flags["no-remote"]) {
    remoteConfigured = await promptRemote(target, repository);
  }
  if (flags.default) setDefaultWorkspace(target, options);
  process.stdout.write(`\n工作区已创建：${target}\n`);
  process.stdout.write(remoteConfigured ? "私有远程仓库已绑定并完成首次推送。\n" : "尚未绑定远程；之后可使用 git remote add origin <url> && git push -u origin main。\n");
  if (flags.default) process.stdout.write(`已设为默认工作区（配置：${getSettingsPath(options)}）。\n启动：npx nnresume\n`);
  else process.stdout.write(`启动：npx nnresume ${JSON.stringify(target)}\n设为默认：npx nnresume default ${JSON.stringify(target)}\n`);
  return target;
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = execFile(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

async function startCommand(appRoot, argv, options = {}) {
  const { values, flags } = parseArguments(argv);
  const workspaceRoot = resolveWorkspace(values[0], options);
  const port = Number(flags.port || process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须是 1-65535 的整数");
  const server = createServer({ appRoot, workspaceRoot });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`nnresume: ${url}\nworkspace: ${workspaceRoot}\n`);
  if (!flags["no-open"]) openBrowser(url);
  setImmediate(() => {
    try {
      fetchRemote(workspaceRoot);
      process.stdout.write("Git: 已刷新远程状态。\n");
    } catch (error) {
      process.stdout.write(`Git: ${error.message}（不影响本地编辑）\n`);
    }
  });
  const close = () => server.close(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return server;
}

async function exportCommand(appRoot, argv, options = {}) {
  const { values, flags } = parseArguments(argv);
  const workspaceRoot = resolveWorkspace(values[0], options);
  const config = readConfig(workspaceRoot);
  const manifest = await exportResume({ appRoot, workspaceRoot, config, label: flags.label || "resume" });
  process.stdout.write(`Exported: ${path.join(workspaceRoot, "exports", manifest.id)}\n`);
  return manifest;
}

function doctorCommand(appRoot, argv, options = {}) {
  const { values } = parseArguments(argv);
  const checks = [];
  checks.push(["Node >= 20", Number(process.versions.node.split(".")[0]) >= 20, process.version]);
  checks.push(["Git", commandExists("git"), commandExists("git") ? "已安装" : "未安装"]);
  checks.push(["GitHub CLI", commandExists("gh"), commandExists("gh") ? (ghAuthenticated() ? "已登录" : "未登录") : "未安装"]);
  try {
    const executable = require("playwright").chromium.executablePath();
    checks.push(["Playwright Chromium", fs.existsSync(executable), executable]);
  } catch (_) {
    checks.push(["Playwright Chromium", false, "运行 npx playwright install chromium"]);
  }
  const cwd = path.resolve(options.cwd || process.cwd());
  let defaultWorkspace = null;
  try {
    defaultWorkspace = readDefaultWorkspace(options);
  } catch (error) {
    checks.push(["用户配置", false, error.message]);
  }
  if (values[0] || fs.existsSync(path.join(cwd, "resume.json")) || defaultWorkspace) {
    try {
      const workspace = resolveWorkspace(values[0], options);
      checks.push(["工作区", true, workspace]);
    } catch (error) {
      checks.push(["工作区", false, error.message]);
    }
  }
  checks.forEach(([name, ok, detail]) => process.stdout.write(`${ok ? "✓" : "✗"} ${name}: ${detail}\n`));
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
  return checks;
}

function defaultCommand(argv, options = {}) {
  const { values, flags } = parseArguments(argv);
  if (values.length > 1) throw new Error("default 命令最多接受一个工作区目录");
  if (flags.clear && values.length) throw new Error("--clear 不能与工作区目录同时使用");
  if (flags.clear) {
    const previous = clearDefaultWorkspace(options);
    process.stdout.write(previous ? `已清除默认工作区：${previous}\n` : "尚未设置默认工作区。\n");
    return null;
  }
  if (!values[0]) {
    const current = readDefaultWorkspace(options);
    process.stdout.write(current ? `默认工作区：${current}\n` : "尚未设置默认工作区。\n");
    return current;
  }
  const workspace = assertWorkspace(values[0]);
  const settingsPath = setDefaultWorkspace(workspace, options);
  process.stdout.write(`默认工作区：${workspace}\n配置：${settingsPath}\n`);
  return workspace;
}

function printHelp() {
  process.stdout.write(`nnresume - 本地简历编辑、Git 版本与多模板导出\n\n`);
  process.stdout.write(`用法：\n  nnresume init [directory] [--default] [--repo owner/name | --remote url]\n  nnresume [directory] [--port 4173] [--no-open]\n  nnresume start [directory] [--port 4173] [--no-open]\n  nnresume export [directory] [--label backend-v2]\n  nnresume default [directory | --clear]\n  nnresume doctor [directory]\n`);
}

async function run(argv, options = {}) {
  const appRoot = options.appRoot || path.join(__dirname, "..");
  const known = new Set(["init", "start", "export", "default", "doctor", "help"]);
  const command = known.has(argv[0]) ? argv[0] : "start";
  const rest = known.has(argv[0]) ? argv.slice(1) : argv;
  if (command === "help" || rest.includes("--help")) return printHelp();
  if (command === "init") return initCommand(appRoot, rest, options);
  if (command === "export") return exportCommand(appRoot, rest, options);
  if (command === "default") return defaultCommand(rest, options);
  if (command === "doctor") return doctorCommand(appRoot, rest, options);
  return startCommand(appRoot, rest, options);
}

module.exports = {
  commandExists,
  createGitHubRepository,
  defaultCommand,
  doctorCommand,
  initCommand,
  parseArguments,
  resolveWorkspace,
  run,
  startCommand,
};
