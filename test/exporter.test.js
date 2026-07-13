const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildSelfContainedHtml, createExportId, sanitizeLabel } = require("../lib/exporter");
const { readConfig } = require("../lib/config");

const appRoot = path.join(__dirname, "..");
const workspaceRoot = path.join(appRoot, "starter");

test("export ids never collide", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-exports-"));
  const now = new Date("2026-07-12T15:30:45.123Z");
  const first = createExportId(root, "后端 v2", now);
  fs.mkdirSync(path.join(root, first));
  const second = createExportId(root, "后端 v2", now);
  assert.notEqual(first, second);
  assert.match(second, /-2$/);
});

test("each template builds a self-contained html document", () => {
  ["classic", "modern"].forEach((template) => {
    const config = readConfig(workspaceRoot);
    config.template = template;
    const html = buildSelfContainedHtml({ appRoot, workspaceRoot, config });
    assert.match(html, /window\.__RESUME_CONFIG__/);
    assert.match(html, /张小明/);
    assert.match(html, new RegExp(`NNRESUME_TEMPLATES\\.${template}`));
    assert.doesNotMatch(html, /href=""/);
    assert.doesNotMatch(html, /src="resume-renderer\.js"/);
  });
});

test("labels are filesystem safe", () => {
  assert.equal(sanitizeLabel(" backend / AI v2 "), "backend-AI-v2");
});
