const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const {
  buildBackgroundArguments,
  createGitHubRepository,
  initCommand,
  parseArguments,
  resolveWorkspace,
  startCommand,
} = require("../lib/cli");
const { clearDefaultWorkspace, readDefaultWorkspace, setDefaultWorkspace } = require("../lib/settings");

const appRoot = path.join(__dirname, "..");

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("argument parser supports inline and separated flags", () => {
  assert.deepEqual(parseArguments(["workspace", "--port=5000", "--no-open", "--label", "v2"]), {
    values: ["workspace"],
    flags: { port: "5000", "no-open": true, label: "v2" },
  });
});

test("background arguments use the resolved workspace without forwarding background flags", () => {
  const workspaceRoot = path.join(os.tmpdir(), "resolved-workspace");
  const args = buildBackgroundArguments(appRoot, workspaceRoot, { background: "true", "no-open": true }, 4567);
  assert.deepEqual(args, [
    path.join(appRoot, "bin", "nnresume.js"),
    "start",
    workspaceRoot,
    "--port=4567",
    "--no-open",
  ]);
  assert.equal(args.some((value) => value.startsWith("--background")), false);
});

test("background start resolves a relative workspace and waits until the server is ready", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-background-"));
  const workspaceRoot = path.join(parent, "workspace");
  fs.cpSync(path.join(appRoot, "starter"), workspaceRoot, { recursive: true });
  const relativeWorkspace = path.relative(process.cwd(), workspaceRoot);
  const port = await getAvailablePort();
  let child;
  try {
    child = await startCommand(appRoot, [relativeWorkspace, "--background", "--no-open", `--port=${port}`]);
    const response = await fetch(`http://127.0.0.1:${port}/api/config`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("x-nnresume-workspace"), /^[a-f0-9]{16}$/);
  } finally {
    if (child?.pid) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
  }
});

test("background start reports a port conflict instead of claiming success", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-background-conflict-"));
  const workspaceRoot = path.join(parent, "workspace");
  fs.cpSync(path.join(appRoot, "starter"), workspaceRoot, { recursive: true });
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const port = blocker.address().port;
  try {
    await assert.rejects(
      () => startCommand(appRoot, [workspaceRoot, "--background", "--no-open", `--port=${port}`]),
      /EADDRINUSE|后台启动失败/,
    );
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("init creates a valid independent Git workspace", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-init-"));
  const target = path.join(parent, "my-resume");
  await initCommand(appRoot, [target, "--no-remote"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, "resume.json"))).schemaVersion, 3);
  assert.equal(fs.existsSync(path.join(target, ".gitignore")), true);
  assert.equal(fs.existsSync(path.join(target, "gitignore")), false);
  const readme = fs.readFileSync(path.join(target, "README.md"), "utf8");
  assert.match(readme, /https:\/\/github\.com\/CBOSSX\/nnresume/);
  assert.match(readme, /npx nnresume/);
  assert.match(readme, /选择并导入/);
  assert.equal(execFileSync("git", ["branch", "--show-current"], { cwd: target, encoding: "utf8" }).trim(), "main");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: target, encoding: "utf8" }).trim(), "");
  await assert.rejects(() => initCommand(appRoot, [target, "--no-remote"]), /目标目录必须为空/);
});

test("init can persist the new workspace as the default", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-default-init-"));
  const target = path.join(parent, "my-resume");
  const configPath = path.join(parent, "config", "config.json");
  await initCommand(appRoot, [target, "--no-remote", "--default"], { configPath });
  assert.equal(readDefaultWorkspace({ configPath }), target);
});

test("workspace resolution uses current workspace before the configured default", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-resolve-"));
  const current = path.join(parent, "current");
  const fallback = path.join(parent, "fallback");
  const outside = path.join(parent, "outside");
  const configPath = path.join(parent, "config.json");
  fs.cpSync(path.join(appRoot, "starter"), current, { recursive: true });
  fs.cpSync(path.join(appRoot, "starter"), fallback, { recursive: true });
  fs.mkdirSync(outside);
  setDefaultWorkspace(fallback, { configPath });

  assert.equal(resolveWorkspace(null, { cwd: current, configPath }), current);
  assert.equal(resolveWorkspace(null, { cwd: outside, configPath }), fallback);
  assert.equal(resolveWorkspace(fallback, { cwd: current, configPath }), fallback);
  assert.equal(clearDefaultWorkspace({ configPath }), fallback);
  assert.equal(readDefaultWorkspace({ configPath }), null);
  assert.throws(() => resolveWorkspace(null, { cwd: outside, configPath }), /设置默认工作区/);
  setDefaultWorkspace(path.join(parent, "missing"), { configPath });
  assert.throws(() => resolveWorkspace(null, { cwd: outside, configPath }), /默认工作区已失效/);
});

test("GitHub creation normalizes SSH remotes to repository-local HTTPS credentials", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-gh-"));
  const target = path.join(parent, "my-resume");
  const remote = path.join(parent, "remote.git");
  const fakeBin = path.join(parent, "bin");
  fs.mkdirSync(fakeBin);
  execFileSync("git", ["init", "--bare", "-b", "main", remote]);
  await initCommand(appRoot, [target, "--no-remote"]);
  const fakeGh = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "repo" && args[1] === "create") {
  execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/my-resume.git"], { cwd: process.cwd() });
} else if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(process.env.NNRESUME_FAKE_REMOTE.slice(0, -4));
} else process.exitCode = 1;
`;
  fs.writeFileSync(path.join(fakeBin, "gh"), fakeGh, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBin}:${previousPath}`;
  process.env.NNRESUME_FAKE_REMOTE = remote;
  try {
    createGitHubRepository(target, "owner/my-resume");
  } finally {
    process.env.PATH = previousPath;
    delete process.env.NNRESUME_FAKE_REMOTE;
  }
  assert.equal(execFileSync("git", ["remote", "get-url", "origin"], { cwd: target, encoding: "utf8" }).trim(), remote);
  assert.equal(execFileSync("git", ["config", "--local", "--get", "credential.https://github.com.helper"], { cwd: target, encoding: "utf8" }).trim(), "!gh auth git-credential");
  assert.equal(execFileSync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: target, encoding: "utf8" }).trim(), "origin/main");
});
