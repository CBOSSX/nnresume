const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { createGitHubRepository, initCommand, parseArguments } = require("../lib/cli");

const appRoot = path.join(__dirname, "..");

test("argument parser supports inline and separated flags", () => {
  assert.deepEqual(parseArguments(["workspace", "--port=5000", "--no-open", "--label", "v2"]), {
    values: ["workspace"],
    flags: { port: "5000", "no-open": true, label: "v2" },
  });
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
