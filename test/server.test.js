const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { readConfig } = require("../lib/config");

const appRoot = path.join(__dirname, "..");

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-server-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "resume.json"), JSON.stringify(readConfig(path.join(appRoot, "starter"))));
  return root;
}

test("server rejects invalid config without replacing the workspace file", async (context) => {
  const workspaceRoot = createWorkspace();
  const original = readConfig(workspaceRoot);
  const server = createServer({ appRoot, workspaceRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const invalid = structuredClone(original);
  invalid.basics.email = "bad";
  const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invalid),
  });
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspaceRoot, "resume.json"))).basics.email, original.basics.email);
});

test("server exposes templates and rejects an unknown template", async (context) => {
  const workspaceRoot = createWorkspace();
  const server = createServer({ appRoot, workspaceRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const templates = await (await fetch(`http://127.0.0.1:${port}/api/templates`)).json();
  assert.deepEqual(templates.map((item) => item.id).sort(), ["classic", "modern"]);
  const invalid = readConfig(workspaceRoot);
  invalid.template = "missing";
  const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invalid),
  });
  assert.equal(response.status, 400);
});
