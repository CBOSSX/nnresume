const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { migrateConfig, readConfig, validateConfig, writeConfigAtomic } = require("../lib/config");

const fixtureRoot = path.join(__dirname, "..", "starter");

test("starter resume config is valid", () => {
  const result = validateConfig(readConfig(fixtureRoot));
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("invalid config is rejected without replacing disk config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-config-"));
  const original = readConfig(fixtureRoot);
  fs.writeFileSync(path.join(root, "resume.json"), JSON.stringify(original));
  const invalid = structuredClone(original);
  invalid.basics.email = "not-an-email";
  assert.throws(() => writeConfigAtomic(root, invalid), /配置校验失败/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "resume.json"))).basics.email, original.basics.email);
});

test("schema v1 work experience migrates through v2 to schema v3", () => {
  const current = readConfig(fixtureRoot);
  const legacy = structuredClone(current);
  legacy.schemaVersion = 1;
  legacy.experience = legacy.experiences[0];
  delete legacy.experiences;
  delete legacy.basics.photo;
  delete legacy.template;
  const migrated = migrateConfig(legacy);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.template, "classic");
  assert.equal(migrated.experiences.length, 1);
  assert.equal(migrated.basics.photo, "assets/profile.png");
});

test("schema v2 keeps content and receives the classic template", () => {
  const legacy = structuredClone(readConfig(fixtureRoot));
  legacy.schemaVersion = 2;
  delete legacy.template;
  const migrated = migrateConfig(legacy);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.template, "classic");
});
