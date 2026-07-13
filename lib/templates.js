const fs = require("fs");
const path = require("path");

const TEMPLATE_ID = /^[a-z][a-z0-9-]{0,39}$/;

function getTemplatesRoot(appRoot) {
  return path.join(appRoot, "templates");
}

function readTemplate(appRoot, id) {
  if (!TEMPLATE_ID.test(String(id || ""))) {
    const error = new Error("模板 ID 不合法");
    error.statusCode = 400;
    throw error;
  }
  const directory = path.join(getTemplatesRoot(appRoot), id);
  const manifestPath = path.join(directory, "template.json");
  if (!fs.existsSync(manifestPath)) {
    const error = new Error(`模板不存在：${id}`);
    error.statusCode = 400;
    throw error;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== id || !manifest.name || !manifest.version) {
    throw new Error(`模板清单无效：${id}`);
  }
  return {
    directory,
    manifest,
    rendererPath: path.join(directory, "renderer.js"),
    stylesPath: path.join(directory, "styles.css"),
  };
}

function listTemplates(appRoot) {
  const root = getTemplatesRoot(appRoot);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && TEMPLATE_ID.test(entry.name))
    .map((entry) => {
      try {
        return readTemplate(appRoot, entry.name).manifest;
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

module.exports = { TEMPLATE_ID, getTemplatesRoot, listTemplates, readTemplate };
