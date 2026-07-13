const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SETTINGS_VERSION = 1;

function getSettingsPath(options = {}) {
  if (options.configPath) return path.resolve(options.configPath);
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const base = env.XDG_CONFIG_HOME
    ? path.resolve(env.XDG_CONFIG_HOME)
    : process.platform === "win32" && env.APPDATA
      ? path.resolve(env.APPDATA)
      : path.join(home, ".config");
  return path.join(base, "nnresume", "config.json");
}

function readSettings(options = {}) {
  const settingsPath = getSettingsPath(options);
  if (!fs.existsSync(settingsPath)) return { version: SETTINGS_VERSION };
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 nnresume 用户配置：${settingsPath}（${error.message}）`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`nnresume 用户配置格式无效：${settingsPath}`);
  }
  if (settings.version !== SETTINGS_VERSION) {
    throw new Error(`不支持的 nnresume 用户配置版本：${settings.version}`);
  }
  if (settings.defaultWorkspace !== undefined && typeof settings.defaultWorkspace !== "string") {
    throw new Error(`nnresume 默认工作区配置无效：${settingsPath}`);
  }
  return settings;
}

function writeSettings(settings, options = {}) {
  const settingsPath = getSettingsPath(options);
  const directory = path.dirname(settingsPath);
  const temporary = path.join(directory, `.config-${process.pid}-${crypto.randomUUID()}.tmp`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, settingsPath);
    if (process.platform !== "win32") fs.chmodSync(settingsPath, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return settingsPath;
}

function readDefaultWorkspace(options = {}) {
  return readSettings(options).defaultWorkspace || null;
}

function setDefaultWorkspace(root, options = {}) {
  const settings = readSettings(options);
  settings.defaultWorkspace = path.resolve(root);
  return writeSettings(settings, options);
}

function clearDefaultWorkspace(options = {}) {
  const settingsPath = getSettingsPath(options);
  if (!fs.existsSync(settingsPath)) return null;
  const settings = readSettings(options);
  const previous = settings.defaultWorkspace || null;
  if (!previous) return null;
  delete settings.defaultWorkspace;
  writeSettings(settings, options);
  return previous;
}

module.exports = {
  clearDefaultWorkspace,
  getSettingsPath,
  readDefaultWorkspace,
  readSettings,
  setDefaultWorkspace,
};
