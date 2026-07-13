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
  const logoResponse = await fetch(`http://127.0.0.1:${port}/nnresume-logo.png`);
  assert.equal(logoResponse.status, 200);
  assert.equal(logoResponse.headers.get("content-type"), "image/png");
  assert.ok((await logoResponse.arrayBuffer()).byteLength > 0);
  const invalid = readConfig(workspaceRoot);
  invalid.template = "missing";
  const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invalid),
  });
  assert.equal(response.status, 400);
});

test("server imports a validated profile photo into controlled assets", async (context) => {
  const workspaceRoot = createWorkspace();
  const server = createServer({ appRoot, workspaceRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const response = await fetch(`http://127.0.0.1:${port}/api/assets/photo`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { path: "assets/profile.png" });
  assert.deepEqual(fs.readFileSync(path.join(workspaceRoot, "assets", "profile.png")), png);

  const assetResponse = await fetch(`http://127.0.0.1:${port}/assets/profile.png`);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");
  const invalid = await fetch(`http://127.0.0.1:${port}/api/assets/photo`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: Buffer.from("not really a png"),
  });
  assert.equal(invalid.status, 400);
  const oversized = await fetch(`http://127.0.0.1:${port}/api/assets/photo`, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);
});
