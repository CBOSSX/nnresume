const { execFileSync } = require("child_process");

const VERSION_PATHS = ["resume.json", "assets"];

function runGit(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20000,
    ...options,
  }).trim();
}

function readOptional(root, args) {
  try {
    return runGit(root, args);
  } catch (_) {
    return null;
  }
}

function getGitStatus(root) {
  try {
    const branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const commit = runGit(root, ["rev-parse", "HEAD"]);
    const porcelain = runGit(root, ["status", "--porcelain"]);
    const resumePorcelain = runGit(root, ["status", "--porcelain", "--", ...VERSION_PATHS]);
    const remote = readOptional(root, ["remote", "get-url", "origin"]);
    const upstream = readOptional(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = runGit(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]).split(/\s+/).map(Number);
      [ahead, behind] = counts;
    }
    return {
      available: true,
      branch,
      commit,
      shortCommit: commit.slice(0, 8),
      dirty: Boolean(porcelain),
      resumeDirty: Boolean(resumePorcelain),
      changes: porcelain ? porcelain.split("\n") : [],
      remote,
      upstream,
      ahead,
      behind,
    };
  } catch (_) {
    return {
      available: false,
      branch: null,
      commit: null,
      shortCommit: null,
      dirty: false,
      resumeDirty: false,
      changes: [],
      remote: null,
      upstream: null,
      ahead: 0,
      behind: 0,
    };
  }
}

function gitError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function commitChanges(root, message) {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f]/.test(normalized)) {
    throw gitError("提交说明不能为空、不能包含控制字符，且不能超过 200 字", 400);
  }
  runGit(root, ["add", "-A", "--", ...VERSION_PATHS]);
  const staged = readOptional(root, ["diff", "--cached", "--name-only", "--", ...VERSION_PATHS]);
  if (!staged) throw gitError("简历内容没有需要提交的变更");
  runGit(root, ["commit", "-m", normalized, "--", ...VERSION_PATHS]);
  return getGitStatus(root);
}

function fetchRemote(root) {
  const status = getGitStatus(root);
  if (!status.remote) throw gitError("尚未配置 origin 远程仓库");
  runGit(root, ["fetch", "--prune", "origin"], { timeout: 30000 });
  return getGitStatus(root);
}

function pushRemote(root) {
  const status = getGitStatus(root);
  if (!status.remote) throw gitError("尚未配置 origin 远程仓库");
  if (status.upstream) runGit(root, ["push"], { timeout: 60000 });
  else runGit(root, ["push", "-u", "origin", status.branch], { timeout: 60000 });
  return getGitStatus(root);
}

function pullRemote(root) {
  let status = getGitStatus(root);
  if (status.dirty) throw gitError("工作区有未提交变更，不能同步远程");
  status = fetchRemote(root);
  if (!status.upstream) throw gitError("当前分支尚未设置 upstream，请先推送一次");
  if (status.ahead > 0 && status.behind > 0) {
    throw gitError("本地与远程已经分叉，请在终端中手动处理后再继续");
  }
  if (status.behind > 0) runGit(root, ["merge", "--ff-only", status.upstream]);
  return getGitStatus(root);
}

function addRemote(root, url) {
  if (!url || /[\u0000-\u001f]/.test(url)) throw gitError("远程 URL 不合法", 400);
  const existing = readOptional(root, ["remote", "get-url", "origin"]);
  if (existing) runGit(root, ["remote", "set-url", "origin", url]);
  else runGit(root, ["remote", "add", "origin", url]);
  return getGitStatus(root);
}

module.exports = {
  VERSION_PATHS,
  addRemote,
  commitChanges,
  fetchRemote,
  getGitStatus,
  pullRemote,
  pushRemote,
  runGit,
};
