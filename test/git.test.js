const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { addRemote, commitChanges, getGitStatus, pullRemote, pushRemote } = require("../lib/git");

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-git-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Resume Test"]);
  git(root, ["config", "user.email", "resume@example.com"]);
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", ".gitkeep"), "");
  fs.writeFileSync(path.join(root, "resume.json"), "{}\n");
  fs.writeFileSync(path.join(root, "README.md"), "initial\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

test("manual versions only stage resume data and controlled assets", () => {
  const root = createRepository();
  fs.writeFileSync(path.join(root, "resume.json"), '{"changed":true}\n');
  fs.writeFileSync(path.join(root, "secret.txt"), "do not commit\n");
  const status = commitChanges(root, "docs: update resume");
  assert.equal(status.dirty, true);
  assert.equal(status.resumeDirty, false);
  assert.equal(git(root, ["show", "--pretty=", "--name-only", "HEAD"]), "resume.json");
  assert.match(git(root, ["status", "--porcelain"]), /\?\? secret\.txt/);
});

test("push and fast-forward-only pull work with a private-style bare remote", () => {
  const root = createRepository();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "resume-remote-"));
  git(remote, ["init", "--bare", "-b", "main"]);
  addRemote(root, remote);
  let status = pushRemote(root);
  assert.equal(status.upstream, "origin/main");
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "resume-clone-"));
  execFileSync("git", ["clone", remote, other]);
  git(other, ["config", "user.name", "Other Test"]);
  git(other, ["config", "user.email", "other@example.com"]);
  fs.writeFileSync(path.join(other, "resume.json"), '{"remote":true}\n');
  git(other, ["add", "resume.json"]);
  git(other, ["commit", "-m", "remote change"]);
  git(other, ["push"]);
  status = pullRemote(root);
  assert.equal(status.behind, 0);
  assert.match(fs.readFileSync(path.join(root, "resume.json"), "utf8"), /remote/);
});

test("pull refuses a dirty worktree", () => {
  const root = createRepository();
  fs.appendFileSync(path.join(root, "README.md"), "dirty\n");
  assert.throws(() => pullRemote(root), /未提交变更/);
  assert.equal(getGitStatus(root).dirty, true);
});
