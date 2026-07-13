const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { clearDefaultWorkspace, getSettingsPath, readSettings, setDefaultWorkspace } = require("../lib/settings");

test("settings path follows XDG_CONFIG_HOME", () => {
  const root = path.join(os.tmpdir(), "nnresume-xdg");
  assert.equal(getSettingsPath({ env: { XDG_CONFIG_HOME: root } }), path.join(root, "nnresume", "config.json"));
});

test("settings are written atomically with a private file mode", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-settings-"));
  const configPath = path.join(root, "nested", "config.json");
  const workspace = path.join(root, "resume");
  setDefaultWorkspace(workspace, { configPath });
  assert.deepEqual(readSettings({ configPath }), { version: 1, defaultWorkspace: workspace });
  if (process.platform !== "win32") assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(configPath)), ["config.json"]);
});

test("invalid settings fail with a useful error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-settings-invalid-"));
  const configPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, "not json\n");
  assert.throws(() => readSettings({ configPath }), /无法读取 nnresume 用户配置/);
});

test("clearing an unset default does not create a settings file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nnresume-settings-clear-"));
  const configPath = path.join(root, "config.json");
  assert.equal(clearDefaultWorkspace({ configPath }), null);
  assert.equal(fs.existsSync(configPath), false);
});
