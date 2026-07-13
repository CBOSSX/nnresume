const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { createServer } = require("../server");

const appRoot = path.join(__dirname, "..");
const workspaceRoot = path.join(appRoot, "examples", "demo");
const screenshotPath = process.env.SCREENSHOT_PATH || path.join(appRoot, "nnresume-editor.png");
const uploadedPhotoPath = path.join(workspaceRoot, "assets", "profile.png");

async function startLocalServer() {
  if (process.env.NNRESUME_URL || process.env.RESUME_MANAGER_URL) {
    return { baseUrl: process.env.NNRESUME_URL || process.env.RESUME_MANAGER_URL, server: null };
  }
  const server = createServer({ appRoot, workspaceRoot });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, server };
}

(async () => {
  const original = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "resume.json"), "utf8"));
  const { baseUrl, server } = await startLocalServer();
  const putConfig = async (config) => {
    const response = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error(`restore config failed: ${response.status}`);
  };
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  page.on("dialog", (dialog) => dialog.accept());

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator('[data-path="basics.name"]').waitFor();
    await page.frameLocator("#preview-frame").getByText("示例大学").waitFor();
    assert.equal(await page.locator("#preview-frame").getAttribute("src"), "preview.html?embedded=1");
    const previewFrame = page.frames().find((frame) => frame.url().includes("preview.html?embedded=1"));
    assert.ok(previewFrame);
    assert.deepEqual(await previewFrame.evaluate(() => ({
      hasInternalScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      pageShadow: getComputedStyle(document.querySelector(".page")).boxShadow,
    })), { hasInternalScroll: false, pageShadow: "none" });

    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    await page.locator("[data-photo-upload]").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: png });
    await page.waitForFunction(() => document.querySelector('[data-path="basics.photo"]')?.value === "assets/profile.png");
    await page.frameLocator("#preview-frame").locator(".profile-photo").waitFor();

    await page.getByRole("button", { name: /现代双栏/ }).click();
    await page.frameLocator("#preview-frame").locator(".modern-page").waitFor();
    assert.equal(await page.getByRole("button", { name: /现代双栏/ }).getAttribute("class"), "template-card selected");

    const titleInput = page.locator('[data-path="basics.title"]');
    await titleInput.fill(`${original.basics.title} E2E`);
    await page.frameLocator("#preview-frame").getByText(`${original.basics.title} E2E`).waitFor();
    await page.getByRole("button", { name: "保存配置" }).click();
    await page.waitForFunction(() => document.getElementById("save-status")?.textContent === "配置已保存");
    const persisted = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(persisted.template, "modern");
    assert.match(persisted.basics.title, /E2E$/);

    await putConfig(original);
    await page.evaluate(() => localStorage.removeItem("nnresume-draft-v1"));
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-path="basics.name"]').waitFor();

    await page.getByRole("button", { name: "导出版本" }).click();
    await page.locator("#export-label").fill("e2e-ui");
    await page.getByRole("button", { name: "保存并导出" }).click();
    await page.getByText(/已导出：.*e2e-ui/).waitFor({ timeout: 30000 });

    await page.locator('[data-tab="history"]').click();
    const historyCard = page.locator(".history-card").filter({ hasText: "e2e-ui" }).first();
    await historyCard.waitFor();
    await historyCard.getByRole("button", { name: "对比" }).click();
    await page.locator("#diff-dialog[open]").waitFor();
    await page.locator("#diff-dialog .button.primary").click();
    await historyCard.getByRole("button", { name: "恢复" }).click();
    await page.getByText(/已恢复，原配置备份为/).waitFor();

    await page.locator('[data-tab="git"]').click();
    await page.getByText("main", { exact: true }).waitFor();
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } finally {
    await putConfig(original).catch(() => {});
    fs.rmSync(uploadedPhotoPath, { force: true });
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  process.stdout.write(`E2E passed. Screenshot: ${screenshotPath}\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
