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
  const assertTabAlignment = async () => {
    const tabAlignment = await page.locator(".tabs").evaluate((tabs) => {
      const indicatorRect = tabs.querySelector(".tab-indicator").getBoundingClientRect();
      const activeTabRect = tabs.querySelector(".tab.active").getBoundingClientRect();
      const activeLabelRect = tabs.querySelector(".tab.active span").getBoundingClientRect();
      const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      const indicatorCenter = center(indicatorRect);
      const tabCenter = center(activeTabRect);
      const labelCenter = center(activeLabelRect);
      return {
        indicatorToLabelX: Math.abs(indicatorCenter.x - labelCenter.x),
        indicatorToTabX: Math.abs(indicatorCenter.x - tabCenter.x),
        labelToTabY: Math.abs(labelCenter.y - tabCenter.y),
      };
    });
    assert.ok(tabAlignment.indicatorToLabelX < 0.5);
    assert.ok(tabAlignment.indicatorToTabX < 0.5);
    assert.ok(tabAlignment.labelToTabY < 0.5);
  };

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator('[data-path="basics.name"]').waitFor();
    const logo = page.locator(".brand-logo");
    await logo.waitFor();
    assert.deepEqual(await logo.evaluate((image) => ({
      complete: image.complete,
      naturalHeight: image.naturalHeight,
      naturalWidth: image.naturalWidth,
    })), { complete: true, naturalHeight: 256, naturalWidth: 256 });
    assert.equal(await page.locator(".brand h1, .brand p").count(), 0);
    await page.frameLocator("#preview-frame").getByText("示例大学").waitFor();
    assert.equal(await page.locator("#preview-frame").getAttribute("src"), "preview.html?embedded=1");
    const previewFrame = page.frames().find((frame) => frame.url().includes("preview.html?embedded=1"));
    assert.ok(previewFrame);
    assert.deepEqual(await previewFrame.evaluate(() => ({
      hasInternalScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      pageShadow: getComputedStyle(document.querySelector(".page")).boxShadow,
    })), { hasInternalScroll: false, pageShadow: "none" });
    assert.equal(await page.locator(".tabs").getAttribute("data-active-tab"), "edit");
    assert.deepEqual(await page.locator("#layout-status").evaluate((status) => ({
      beforeZoom: status.nextElementSibling?.classList.contains("zoom-control") || false,
      inPreviewTools: Boolean(status.closest(".preview-tools")),
    })), { beforeZoom: true, inPreviewTools: true });

    const controlHeights = await page.evaluate(() => Object.fromEntries(Object.entries({
      a4: document.getElementById("layout-status"),
      branch: document.getElementById("git-status-chip"),
      exportButton: document.getElementById("export-button"),
      fit: document.getElementById("zoom-fit"),
      open: document.querySelector(".open-preview"),
      saveButton: document.getElementById("save-button"),
      saveStatus: document.getElementById("save-status"),
      tabs: document.querySelector(".tabs"),
      zoom: document.querySelector(".zoom-control"),
    }).map(([name, element]) => [name, element.getBoundingClientRect().height])));
    Object.values(controlHeights).forEach((height) => assert.ok(Math.abs(height - 36) < 0.5));

    await assertTabAlignment();

    const savedTabsLeft = await page.locator(".tabs").evaluate((tabs) => tabs.getBoundingClientRect().left);
    const nameInput = page.locator('[data-path="basics.name"]');
    await nameInput.fill(`${original.basics.name} `);
    await page.waitForFunction(() => document.getElementById("save-status")?.textContent === "有未保存修改");
    const dirtyTabsLeft = await page.locator(".tabs").evaluate((tabs) => tabs.getBoundingClientRect().left);
    assert.ok(Math.abs(savedTabsLeft - dirtyTabsLeft) < 0.5);
    await nameInput.fill(original.basics.name);
    await page.waitForFunction(() => document.getElementById("save-status")?.textContent === "配置已保存");

    const initialZoom = Number((await page.locator("#zoom-value").innerText()).replace("%", ""));
    await page.locator("#zoom-in").click();
    await page.waitForFunction((previous) => Number(document.getElementById("zoom-value").textContent.replace("%", "")) > previous, initialZoom);
    assert.equal(await page.locator("#zoom-fit").getAttribute("aria-pressed"), "false");
    await page.locator("#zoom-fit").click();
    assert.equal(await page.locator("#zoom-fit").getAttribute("aria-pressed"), "true");

    const photoLayout = await page.locator(".photo-upload-row").evaluate((row) => {
      const rowStyle = getComputedStyle(row);
      const previewRect = row.querySelector(".photo-upload-preview").getBoundingClientRect();
      const helpRect = row.querySelector(".photo-upload-controls small").getBoundingClientRect();
      const pickerRect = row.querySelector(".photo-picker .button").getBoundingClientRect();
      const pathRect = row.querySelector(".photo-path-field input").getBoundingClientRect();
      return {
        previewWidth: previewRect.width,
        previewHeight: previewRect.height,
        innerHeight: row.clientHeight - parseFloat(rowStyle.paddingTop) - parseFloat(rowStyle.paddingBottom),
        helpTopOffset: Math.abs(helpRect.top - previewRect.top),
        pathBottomOffset: Math.abs(pathRect.bottom - previewRect.bottom),
        pickerBottomOffset: Math.abs(pickerRect.bottom - previewRect.bottom),
        pickerAfterPath: pickerRect.left >= pathRect.right,
      };
    });
    assert.ok(photoLayout.previewWidth >= 100);
    assert.ok(Math.abs(photoLayout.previewHeight - photoLayout.innerHeight) < 1);
    assert.ok(photoLayout.helpTopOffset < 1);
    assert.ok(photoLayout.pathBottomOffset < 1);
    assert.ok(photoLayout.pickerBottomOffset < 1);
    assert.equal(photoLayout.pickerAfterPath, true);

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
    assert.equal(await page.locator(".tabs").getAttribute("data-active-tab"), "history");
    await page.waitForTimeout(300);
    await assertTabAlignment();
    const historyCard = page.locator(".history-card").filter({ hasText: "e2e-ui" }).first();
    await historyCard.waitFor();
    await historyCard.getByRole("button", { name: "对比" }).click();
    await page.locator("#diff-dialog[open]").waitFor();
    await page.locator("#diff-dialog .button.primary").click();
    await historyCard.getByRole("button", { name: "恢复" }).click();
    await page.getByText(/已恢复，原配置备份为/).waitFor();

    const gitStatus = await (await fetch(`${baseUrl}/api/git/status`)).json();
    await page.locator('[data-tab="git"]').click();
    assert.equal(await page.locator(".tabs").getAttribute("data-active-tab"), "git");
    await page.waitForTimeout(300);
    await assertTabAlignment();
    await page.getByText(gitStatus.branch, { exact: true }).waitFor();
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
