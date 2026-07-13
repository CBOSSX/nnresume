const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { migrateConfig, validateConfig } = require("../lib/config");

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function git(source, args, options = {}) {
  return execFileSync("git", args, { cwd: source, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
}

function readGitFile(source, commit, file, encoding = "utf8") {
  try {
    return execFileSync("git", ["show", `${commit}:${file}`], {
      cwd: source,
      encoding: encoding === null ? null : encoding,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (_) {
    return null;
  }
}

function parseLegacyJavaScript(source) {
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  if (!sandbox.window.RESUME_CONFIG) throw new Error("旧版 resume.config.js 中没有 RESUME_CONFIG");
  return JSON.parse(JSON.stringify(sandbox.window.RESUME_CONFIG));
}

function normalizeHistoricalConfig(input, hasPhoto) {
  const source = JSON.parse(JSON.stringify(input));
  if (!source.schemaVersion) source.schemaVersion = 1;
  const config = migrateConfig(source);
  config.schemaVersion = 3;
  config.template = config.template || "classic";
  config.basics = { ...config.basics, photo: hasPhoto ? "assets/profile.png" : "" };
  const validation = validateConfig(config);
  if (!validation.valid) {
    const error = new Error("历史配置无法迁移");
    error.validationErrors = validation.errors;
    throw error;
  }
  return config;
}

function listHistoricalVersions(source) {
  const format = "%H%x1f%aI%x1f%an%x1f%ae%x1f%s%x1e";
  return git(source, ["log", "--reverse", `--format=${format}`, "--", "resume.config.js", "resume.json", "assets/profile.png"])
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [commit, date, authorName, authorEmail, subject] = record.split("\x1f");
      return { commit, date, authorName, authorEmail, subject };
    });
}

function writeVersion(target, config, photo) {
  fs.mkdirSync(path.join(target, "assets"), { recursive: true });
  fs.writeFileSync(path.join(target, "resume.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  const photoPath = path.join(target, "assets", "profile.png");
  if (photo) fs.writeFileSync(photoPath, photo, { mode: 0o600 });
  else if (fs.existsSync(photoPath)) fs.rmSync(photoPath);
  if (!fs.readdirSync(path.join(target, "assets")).length) fs.writeFileSync(path.join(target, "assets", ".gitkeep"), "");
  else if (fs.existsSync(path.join(target, "assets", ".gitkeep"))) fs.rmSync(path.join(target, "assets", ".gitkeep"));
}

function commitVersion(target, version) {
  git(target, ["add", "-A", "--", "resume.json", "assets", ".gitignore", "README.md"]);
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: version.authorName,
    GIT_AUTHOR_EMAIL: version.authorEmail,
    GIT_AUTHOR_DATE: version.date,
    GIT_COMMITTER_NAME: version.authorName,
    GIT_COMMITTER_EMAIL: version.authorEmail,
    GIT_COMMITTER_DATE: version.date,
  };
  git(target, ["commit", "--allow-empty", "-m", version.subject, "-m", `Migrated-From: ${version.commit}`], { env: environment });
}

function initializeTarget(target) {
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`迁移目标必须为空：${target}`);
  fs.mkdirSync(path.join(target, "assets"), { recursive: true });
  fs.writeFileSync(path.join(target, ".gitignore"), "exports/\n*.log\n.DS_Store\n*.tmp-*\n");
  fs.writeFileSync(path.join(target, "README.md"), "# My Resume\n\nPrivate nnresume workspace.\n");
  git(target, ["init", "-b", "main"]);
}

function migrateHistory({ source, target, current, photo }) {
  const sourceRoot = path.resolve(source);
  const targetRoot = path.resolve(target);
  initializeTarget(targetRoot);
  const versions = listHistoricalVersions(sourceRoot);
  versions.forEach((version) => {
    const json = readGitFile(sourceRoot, version.commit, "resume.json");
    const javascript = json ? null : readGitFile(sourceRoot, version.commit, "resume.config.js");
    if (!json && !javascript) return;
    const image = readGitFile(sourceRoot, version.commit, "assets/profile.png", null);
    const raw = json ? JSON.parse(json) : parseLegacyJavaScript(javascript);
    writeVersion(targetRoot, normalizeHistoricalConfig(raw, Boolean(image)), image);
    commitVersion(targetRoot, version);
  });
  if (current) {
    const raw = JSON.parse(fs.readFileSync(current, "utf8"));
    const image = photo && fs.existsSync(photo) ? fs.readFileSync(photo) : null;
    writeVersion(targetRoot, normalizeHistoricalConfig(raw, Boolean(image)), image);
    const now = new Date().toISOString();
    commitVersion(targetRoot, {
      authorName: git(sourceRoot, ["config", "user.name"]).trim() || "nnresume",
      authorEmail: git(sourceRoot, ["config", "user.email"]).trim() || "nnresume@localhost",
      date: now,
      subject: "docs: migrate current resume",
      commit: "working-tree",
    });
  }
  return { target: targetRoot, versions: git(targetRoot, ["rev-list", "--count", "HEAD"]).trim() };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.source || !options.target) throw new Error("用法：--source <repo> --target <workspace> [--current file --photo file]");
    const result = migrateHistory(options);
    process.stdout.write(`Migrated ${result.versions} versions to ${result.target}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    if (error.validationErrors) process.stderr.write(`${JSON.stringify(error.validationErrors, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { listHistoricalVersions, migrateHistory, normalizeHistoricalConfig, parseLegacyJavaScript };
