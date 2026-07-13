const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeHistoricalConfig, parseLegacyJavaScript } = require("../scripts/migrate-personal-history");

test("legacy JavaScript resumes migrate without evaluating host globals", () => {
  const legacy = parseLegacyJavaScript(`window.RESUME_CONFIG = {
    basics: { name: "Test", title: "Engineer", phone: "13800000000", email: "test@example.com" },
    education: [{ school: "School", major: "CS", degree: "BS", date: "2020" }],
    skills: [{ category: "Code", items: "Node.js" }],
    experience: { company: "Company", role: "Engineer", date: "2024", projects: [{ name: "Project", tag: "", intro: "Intro", bullets: ["Result"] }] },
    footer: "Test"
  };`);
  const migrated = normalizeHistoricalConfig(legacy, false);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.template, "classic");
  assert.equal(migrated.basics.photo, "");
  assert.equal(migrated.experiences[0].company, "Company");
});
