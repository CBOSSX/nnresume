const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../server");
const { readConfig } = require("../lib/config");
const { createBackupSnapshot } = require("../lib/exporter");

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

test("server exposes config revision and rejects stale writes", async (context) => {
  const workspaceRoot = createWorkspace();
  const server = createServer({ appRoot, workspaceRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/api/config`;
  const first = await fetch(url);
  const revision = first.headers.get("x-nnresume-revision");
  const workspace = first.headers.get("x-nnresume-workspace");
  assert.match(revision, /^[a-f0-9]{16}$/);
  assert.match(workspace, /^[a-f0-9]{16}$/);

  const external = readConfig(workspaceRoot);
  external.basics.title = "Remote update";
  fs.writeFileSync(path.join(workspaceRoot, "resume.json"), `${JSON.stringify(external, null, 2)}\n`);

  const stale = await first.json();
  stale.basics.title = "Stale browser update";
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": `"${revision}"` },
    body: JSON.stringify(stale),
  });
  assert.equal(response.status, 412);
  assert.equal(readConfig(workspaceRoot).basics.title, "Remote update");
});

test("server guards restores with revisions and returns the restored revision", async (context) => {
  const workspaceRoot = createWorkspace();
  const historical = readConfig(workspaceRoot);
  historical.basics.title = "Historical title";
  const snapshot = createBackupSnapshot({ root: workspaceRoot, config: historical, label: "historical" });
  const server = createServer({ appRoot, workspaceRoot });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = server.address().port;
  const configUrl = `http://127.0.0.1:${port}/api/config`;
  const restoreUrl = `http://127.0.0.1:${port}/api/exports/${snapshot.id}/restore`;

  const initial = await fetch(configUrl);
  const initialRevision = initial.headers.get("x-nnresume-revision");
  const external = await initial.json();
  external.basics.title = "External update";
  fs.writeFileSync(path.join(workspaceRoot, "resume.json"), `${JSON.stringify(external, null, 2)}\n`);

  const staleRestore = await fetch(restoreUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "If-Match": `"${initialRevision}"` },
    body: "{}",
  });
  assert.equal(staleRestore.status, 412);
  assert.equal(readConfig(workspaceRoot).basics.title, "External update");

  const current = await fetch(configUrl);
  const currentRevision = current.headers.get("x-nnresume-revision");
  const restored = await fetch(restoreUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "If-Match": `"${currentRevision}"` },
    body: "{}",
  });
  assert.equal(restored.status, 200);
  const restoredRevision = restored.headers.get("x-nnresume-revision");
  assert.match(restoredRevision, /^[a-f0-9]{16}$/);
  assert.notEqual(restoredRevision, currentRevision);
  assert.equal(readConfig(workspaceRoot).basics.title, "Historical title");

  const followup = readConfig(workspaceRoot);
  followup.basics.title = "Saved after restore";
  const saved = await fetch(configUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "If-Match": `"${restoredRevision}"` },
    body: JSON.stringify(followup),
  });
  assert.equal(saved.status, 200);
  assert.equal(readConfig(workspaceRoot).basics.title, "Saved after restore");
});
