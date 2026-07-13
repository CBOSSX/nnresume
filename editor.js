(function resumeEditor() {
  "use strict";

  const DRAFT_KEY = "nnresume-draft-v1";
  const LEGACY_DRAFT_KEY = "resume-manager-draft-v1";
  const THEME_KEY = "nnresume-theme-v1";
  const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const elements = {
    form: document.getElementById("editor-form"),
    frame: document.getElementById("preview-frame"),
    previewStage: document.getElementById("preview-stage"),
    previewCanvas: document.getElementById("preview-canvas"),
    zoomOut: document.getElementById("zoom-out"),
    zoomIn: document.getElementById("zoom-in"),
    zoomFit: document.getElementById("zoom-fit"),
    zoomValue: document.getElementById("zoom-value"),
    tabs: document.querySelector(".tabs"),
    themeSelect: document.getElementById("theme-select"),
    saveButton: document.getElementById("save-button"),
    exportButton: document.getElementById("export-button"),
    saveStatus: document.getElementById("save-status"),
    layoutStatus: document.getElementById("layout-status"),
    gitStatusChip: document.getElementById("git-status-chip"),
    validation: document.getElementById("validation-errors"),
    draftBanner: document.getElementById("draft-banner"),
    historyList: document.getElementById("history-list"),
    gitDetails: document.getElementById("git-details"),
    commitMessage: document.getElementById("commit-message"),
    commitButton: document.getElementById("commit-button"),
    fetchButton: document.getElementById("fetch-button"),
    pullButton: document.getElementById("pull-button"),
    pushButton: document.getElementById("push-button"),
    exportDialog: document.getElementById("export-dialog"),
    exportLabel: document.getElementById("export-label"),
    confirmExport: document.getElementById("confirm-export"),
    diffDialog: document.getElementById("diff-dialog"),
    diffTitle: document.getElementById("diff-title"),
    diffContent: document.getElementById("diff-content"),
    toast: document.getElementById("toast"),
  };
  const state = {
    config: null,
    saved: null,
    templates: [],
    history: [],
    git: null,
    dirty: false,
    overflow: false,
    assetVersion: 0,
    previewZoom: 1,
    previewFit: true,
    theme: "system",
  };
  const MIN_PREVIEW_ZOOM = 0.35;
  const MAX_PREVIEW_ZOOM = 1.2;
  const PREVIEW_ZOOM_STEP = 0.1;
  let previewTimer;
  let toastTimer;

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const readDraft = () => {
    const current = localStorage.getItem(DRAFT_KEY);
    if (current) return JSON.parse(current);
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!legacy) return null;
    localStorage.setItem(DRAFT_KEY, legacy);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    return JSON.parse(legacy);
  };
  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  };
  const readTheme = () => {
    try {
      const theme = localStorage.getItem(THEME_KEY);
      return theme === "light" || theme === "dark" ? theme : "system";
    } catch (_) {
      return "system";
    }
  };
  const resolveTheme = (theme) => theme === "system" ? (themeQuery.matches ? "dark" : "light") : theme;
  function applyTheme(theme, persist = false) {
    state.theme = theme === "light" || theme === "dark" ? theme : "system";
    document.documentElement.dataset.theme = resolveTheme(state.theme);
    elements.themeSelect.value = state.theme;
    if (!persist) return;
    try {
      if (state.theme === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, state.theme);
    } catch (_) {
      // The selected theme still applies for this page when storage is unavailable.
    }
  }
  const canonical = (value) => {
    const copy = clone(value);
    delete copy.updatedAt;
    return JSON.stringify(copy);
  };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `请求失败：${response.status}`);
      error.details = data.errors;
      throw error;
    }
    return data;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
  }

  function setChip(element, text, type = "neutral") {
    element.textContent = text;
    element.className = `status-chip ${type}`;
  }

  function updateStatus() {
    state.dirty = state.config && state.saved ? canonical(state.config) !== canonical(state.saved) : false;
    setChip(elements.saveStatus, state.dirty ? "有未保存修改" : "配置已保存", state.dirty ? "warning" : "success");
    elements.commitButton.disabled = state.dirty;
    if (state.git?.available) {
      setChip(
        elements.gitStatusChip,
        `${state.git.branch} · ${state.git.shortCommit}${state.git.ahead ? ` · ↑${state.git.ahead}` : ""}${state.git.behind ? ` · ↓${state.git.behind}` : ""}${state.git.dirty ? " · dirty" : ""}`,
        state.git.dirty || state.git.behind ? "warning" : "success",
      );
    }
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), config: state.config }));
  }

  function postPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const config = clone(state.config);
      if (state.assetVersion && /^assets\//.test(config.basics.photo)) {
        config.basics.photo = `${config.basics.photo}?v=${state.assetVersion}`;
      }
      elements.frame.contentWindow?.postMessage({ type: "resume:preview", config }, window.location.origin);
    }, 80);
  }

  function applyPreviewZoom(value, options = {}) {
    const zoom = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, value));
    const frameWidth = elements.frame.offsetWidth || (210 * 96 / 25.4);
    const frameHeight = elements.frame.offsetHeight || (297 * 96 / 25.4);
    state.previewZoom = zoom;
    state.previewFit = Boolean(options.fit);
    elements.previewCanvas.style.width = `${frameWidth * zoom}px`;
    elements.previewCanvas.style.height = `${frameHeight * zoom}px`;
    elements.frame.style.transform = `scale(${zoom})`;
    elements.zoomValue.value = `${Math.round(zoom * 100)}%`;
    elements.zoomValue.textContent = elements.zoomValue.value;
    elements.zoomOut.disabled = zoom <= MIN_PREVIEW_ZOOM;
    elements.zoomIn.disabled = zoom >= MAX_PREVIEW_ZOOM;
    elements.zoomFit.classList.toggle("active", state.previewFit);
    elements.zoomFit.setAttribute("aria-pressed", String(state.previewFit));
  }

  function fitPreview() {
    const stageStyle = getComputedStyle(elements.previewStage);
    const availableWidth = elements.previewStage.clientWidth
      - parseFloat(stageStyle.paddingLeft)
      - parseFloat(stageStyle.paddingRight);
    const availableHeight = elements.previewStage.clientHeight
      - parseFloat(stageStyle.paddingTop)
      - parseFloat(stageStyle.paddingBottom);
    const frameWidth = elements.frame.offsetWidth || (210 * 96 / 25.4);
    const frameHeight = elements.frame.offsetHeight || (297 * 96 / 25.4);
    const scale = Math.min(1, availableWidth / frameWidth, availableHeight / frameHeight);
    applyPreviewZoom(Number.isFinite(scale) ? scale : 1, { fit: true });
  }

  function markChanged() {
    saveDraft();
    updateStatus();
    postPreview();
  }

  function setByPath(object, path, value) {
    const parts = path.split(".");
    let cursor = object;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) cursor[part] = value;
      else cursor = cursor[part];
    });
  }

  function field(label, path, value, options = {}) {
    const tag = options.textarea ? "textarea" : "input";
    const attributes = options.textarea ? "" : ` type="${options.type || "text"}"`;
    const content = options.textarea ? escapeHtml(value) : "";
    const valueAttribute = options.textarea ? "" : ` value="${escapeHtml(value)}"`;
    return `<label class="field ${options.wide ? "wide" : ""}"><span>${escapeHtml(label)}</span><${tag}${attributes} data-path="${escapeHtml(path)}"${valueAttribute}>${content}</${tag}></label>`;
  }

  function photoField(value) {
    const photo = String(value || "").trim();
    const previewUrl = photo && state.assetVersion ? `${photo}?v=${state.assetVersion}` : photo;
    return `<div class="field wide photo-field">
      <span>个人照片</span>
      <div class="photo-upload-row">
        ${photo ? `<img class="photo-upload-preview" src="${escapeHtml(previewUrl)}" alt="当前个人照片" />` : '<div class="photo-upload-preview photo-upload-placeholder">暂无照片</div>'}
        <div class="photo-upload-controls">
          <small>支持 PNG、JPEG、WebP，最大 5 MB；图片保存在当前私有工作区的 assets/ 中。</small>
          <div class="photo-upload-inline">
            <label class="photo-path-field" title="通常无需手动修改">
              <span>资源路径</span>
              <input type="text" data-path="basics.photo" value="${escapeHtml(value)}" placeholder="assets/profile.png" />
            </label>
            <label class="photo-picker">
              <span class="button secondary compact">选择并导入图片</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" data-photo-upload aria-label="选择并导入个人照片" />
            </label>
            ${photo ? '<button class="button ghost compact" type="button" data-action="remove-photo">从简历移除</button>' : ""}
          </div>
        </div>
      </div>
    </div>`;
  }

  function itemActions(type, index, length, extra = "") {
    return `<div class="item-actions">
      <button class="mini-button" type="button" data-action="move-${type}" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
      <button class="mini-button" type="button" data-action="move-${type}" data-index="${index}" data-direction="1" ${index === length - 1 ? "disabled" : ""}>↓</button>
      <button class="mini-button danger" type="button" data-action="remove-${type}" data-index="${index}" ${extra}>删除</button>
    </div>`;
  }

  function renderEditor() {
    const config = state.config;
    elements.form.innerHTML = `
      <details class="form-section" data-section="template" open>
        <summary>简历模板</summary>
        <div class="section-content template-grid">
          ${state.templates.map((template) => `<button class="template-card ${config.template === template.id ? "selected" : ""}" type="button" data-action="select-template" data-template-id="${escapeHtml(template.id)}">
            <span class="template-thumbnail template-${escapeHtml(template.id)}"><i></i><i></i><i></i></span>
            <strong>${escapeHtml(template.name)}</strong>
            <small>${escapeHtml(template.description)}</small>
            <em>${config.template === template.id ? "当前模板" : "切换模板"}</em>
          </button>`).join("")}
        </div>
      </details>
      <details class="form-section" data-section="basics" open>
        <summary>基本信息</summary>
        <div class="section-content field-grid">
          ${field("姓名", "basics.name", config.basics.name)}
          ${field("手机号", "basics.phone", config.basics.phone)}
          ${field("目标岗位", "basics.title", config.basics.title, { wide: true })}
          ${field("邮箱", "basics.email", config.basics.email, { type: "email", wide: true })}
          ${photoField(config.basics.photo || "")}
          ${field("页脚", "footer", config.footer, { wide: true })}
        </div>
      </details>
      <details class="form-section" data-section="education" open>
        <summary>教育经历</summary>
        <div class="section-content">
          ${config.education.map((item, index) => `<div class="item-card">
            <div class="item-card-header"><strong>教育 ${index + 1}</strong>${itemActions("education", index, config.education.length, config.education.length === 1 ? "disabled" : "")}</div>
            <div class="field-grid">
              ${field("学校", `education.${index}.school`, item.school)}
              ${field("时间", `education.${index}.date`, item.date)}
              ${field("专业", `education.${index}.major`, item.major)}
              ${field("学历", `education.${index}.degree`, item.degree)}
            </div>
          </div>`).join("")}
          <button class="add-button" type="button" data-action="add-education">＋ 添加教育经历</button>
        </div>
      </details>
      <details class="form-section" data-section="skills" open>
        <summary>核心技能</summary>
        <div class="section-content">
          ${config.skills.map((item, index) => `<div class="item-card">
            <div class="item-card-header"><strong>技能分组 ${index + 1}</strong>${itemActions("skill", index, config.skills.length, config.skills.length === 1 ? "disabled" : "")}</div>
            <div class="field-grid">
              ${field("分组名称", `skills.${index}.category`, item.category)}
              ${field("技能列表", `skills.${index}.items`, item.items, { wide: true, textarea: true })}
            </div>
          </div>`).join("")}
          <button class="add-button" type="button" data-action="add-skill">＋ 添加技能分组</button>
        </div>
      </details>
      <details class="form-section" data-section="experience" open>
        <summary>工作与项目</summary>
        <div class="section-content">
          ${config.experiences.map((experience, experienceIndex) => `<div class="item-card experience-editor">
            <div class="item-card-header"><strong>工作经历 ${experienceIndex + 1}</strong>${itemActions("experience", experienceIndex, config.experiences.length, config.experiences.length === 1 ? "disabled" : "")}</div>
            <div class="field-grid">
              ${field("公司 / 团队", `experiences.${experienceIndex}.company`, experience.company)}
              ${field("任职时间", `experiences.${experienceIndex}.date`, experience.date)}
              ${field("岗位", `experiences.${experienceIndex}.role`, experience.role, { wide: true })}
            </div>
            ${experience.projects.map((project, projectIndex) => `<div class="item-card project-editor">
              <div class="item-card-header"><strong>项目 ${projectIndex + 1}</strong>${itemActions("project", projectIndex, experience.projects.length, experience.projects.length === 1 ? "disabled" : "").replaceAll(`data-index="${projectIndex}"`, `data-index="${projectIndex}" data-experience-index="${experienceIndex}"`)}</div>
              <div class="field-grid">
                ${field("项目名称", `experiences.${experienceIndex}.projects.${projectIndex}.name`, project.name, { wide: true })}
                ${field("项目标签", `experiences.${experienceIndex}.projects.${projectIndex}.tag`, project.tag)}
                ${field("项目简介", `experiences.${experienceIndex}.projects.${projectIndex}.intro`, project.intro, { wide: true, textarea: true })}
              </div>
              <div class="bullet-list">
                ${project.bullets.map((bullet, bulletIndex) => `<div class="bullet-card">
                  <div class="item-card-header"><strong>要点 ${bulletIndex + 1}</strong>${itemActions("bullet", bulletIndex, project.bullets.length, project.bullets.length === 1 ? "disabled" : "").replaceAll(`data-index="${bulletIndex}"`, `data-index="${bulletIndex}" data-experience-index="${experienceIndex}" data-project-index="${projectIndex}"`)}</div>
                  ${field("内容（**文字** 可加粗）", `experiences.${experienceIndex}.projects.${projectIndex}.bullets.${bulletIndex}`, bullet, { wide: true, textarea: true })}
                </div>`).join("")}
              </div>
              <button class="add-button" type="button" data-action="add-bullet" data-experience-index="${experienceIndex}" data-project-index="${projectIndex}">＋ 添加项目要点</button>
            </div>`).join("")}
            <button class="add-button" type="button" data-action="add-project" data-experience-index="${experienceIndex}">＋ 添加项目</button>
          </div>`).join("")}
          <button class="add-button" type="button" data-action="add-experience">＋ 添加工作经历</button>
        </div>
      </details>`;
  }

  function move(array, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= array.length) return;
    [array[index], array[target]] = [array[target], array[index]];
  }

  function handleAction(button) {
    const action = button.dataset.action;
    const index = Number(button.dataset.index);
    const direction = Number(button.dataset.direction);
    const experienceIndex = Number(button.dataset.experienceIndex);
    const projectIndex = Number(button.dataset.projectIndex);
    if (action === "select-template") state.config.template = button.dataset.templateId;
    if (action === "add-education") state.config.education.push({ school: "新学校", major: "专业", degree: "学历", date: "起止时间" });
    if (action === "remove-education") state.config.education.splice(index, 1);
    if (action === "move-education") move(state.config.education, index, direction);
    if (action === "add-skill") state.config.skills.push({ category: "新分组", items: "技能 1、技能 2" });
    if (action === "remove-skill") state.config.skills.splice(index, 1);
    if (action === "move-skill") move(state.config.skills, index, direction);
    if (action === "add-experience") state.config.experiences.push({ company: "新公司 / 团队", role: "岗位", date: "起止时间", projects: [{ name: "新项目", tag: "", intro: "项目简介", bullets: ["项目要点"] }] });
    if (action === "remove-experience") state.config.experiences.splice(index, 1);
    if (action === "move-experience") move(state.config.experiences, index, direction);
    if (action === "add-project") state.config.experiences[experienceIndex].projects.push({ name: "新项目", tag: "", intro: "项目简介", bullets: ["项目要点"] });
    if (action === "remove-project") state.config.experiences[experienceIndex].projects.splice(index, 1);
    if (action === "move-project") move(state.config.experiences[experienceIndex].projects, index, direction);
    if (action === "add-bullet") state.config.experiences[experienceIndex].projects[projectIndex].bullets.push("新的项目要点");
    if (action === "remove-bullet") state.config.experiences[experienceIndex].projects[projectIndex].bullets.splice(index, 1);
    if (action === "move-bullet") move(state.config.experiences[experienceIndex].projects[projectIndex].bullets, index, direction);
    if (action === "remove-photo") state.config.basics.photo = "";
    renderEditor();
    markChanged();
  }

  async function uploadPhoto(input) {
    const [file] = input.files || [];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      input.value = "";
      showToast("图片不能超过 5 MB");
      return;
    }
    input.disabled = true;
    try {
      const response = await fetch("/api/assets/photo", {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `图片导入失败：${response.status}`);
      state.config.basics.photo = data.path;
      state.assetVersion = Date.now();
      renderEditor();
      markChanged();
      showToast("照片已导入，请保存配置");
    } catch (error) {
      input.disabled = false;
      input.value = "";
      showToast(error.message);
    }
  }

  function showValidation(error) {
    const details = error.details || [];
    elements.validation.innerHTML = details.length
      ? `<strong>${escapeHtml(error.message)}</strong><ul>${details.map((item) => `<li>${escapeHtml(item.path)}：${escapeHtml(item.message)}</li>`).join("")}</ul>`
      : escapeHtml(error.message);
    elements.validation.hidden = false;
  }

  async function saveConfig() {
    elements.validation.hidden = true;
    elements.saveButton.disabled = true;
    try {
      const saved = await api("/api/config", { method: "PUT", body: JSON.stringify(state.config) });
      state.config = clone(saved);
      state.saved = clone(saved);
      clearDraft();
      await loadGit();
      updateStatus();
      showToast("配置已保存");
      return saved;
    } catch (error) {
      showValidation(error);
      throw error;
    } finally {
      elements.saveButton.disabled = false;
    }
  }

  function flatten(value, prefix = "", output = {}) {
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key, output));
    } else {
      output[prefix] = value;
    }
    return output;
  }

  async function showDiff(id) {
    const historical = await api(`/api/exports/${encodeURIComponent(id)}`);
    const current = flatten(state.config);
    const previous = flatten(historical.config);
    const paths = [...new Set([...Object.keys(current), ...Object.keys(previous)])].filter((path) => current[path] !== previous[path]);
    elements.diffTitle.textContent = `与 ${id} 的差异`;
    elements.diffContent.innerHTML = paths.length
      ? paths.map((path) => `<div class="diff-row"><div class="diff-path">${escapeHtml(path)}</div><div class="diff-old">${escapeHtml(previous[path] ?? "∅")}</div><div class="diff-new">${escapeHtml(current[path] ?? "∅")}</div></div>`).join("")
      : '<div class="empty-state">当前配置与该快照完全一致。</div>';
    elements.diffDialog.showModal();
  }

  async function restoreExport(id) {
    if (!window.confirm(`恢复 ${id}？恢复前会自动备份当前配置。`)) return;
    const result = await api(`/api/exports/${encodeURIComponent(id)}/restore`, { method: "POST", body: "{}" });
    state.config = clone(result.config);
    state.saved = clone(result.config);
    clearDraft();
    renderEditor();
    postPreview();
    await Promise.all([loadHistory(), loadGit()]);
    updateStatus();
    showToast(`已恢复，原配置备份为 ${result.backup.id}`);
  }

  function renderHistory() {
    if (!state.history.length) {
      elements.historyList.innerHTML = '<div class="empty-state">还没有导出记录。</div>';
      return;
    }
    elements.historyList.innerHTML = state.history.map((item) => {
      const isExport = item.kind === "export";
      return `<article class="history-card">
        ${isExport ? `<img class="history-thumb" src="/exports/${encodeURIComponent(item.id)}/resume.png" alt="${escapeHtml(item.label)} 预览" />` : '<div class="history-thumb history-placeholder">恢复备份</div>'}
        <div class="history-info">
          <h3>${escapeHtml(item.id)}</h3>
          <p>${escapeHtml(new Date(item.exportedAt).toLocaleString())} · ${escapeHtml(item.git?.shortCommit || "无 Git")}${item.git?.dirty ? " · dirty" : ""}</p>
          <p>${isExport ? "完整导出" : "恢复前配置备份"}</p>
          <div class="history-actions">
            <button class="button ghost compact" type="button" data-history-action="diff" data-id="${escapeHtml(item.id)}">对比</button>
            <button class="button ghost compact" type="button" data-history-action="restore" data-id="${escapeHtml(item.id)}">恢复</button>
            ${isExport ? `<a class="button ghost compact" target="_blank" href="/exports/${encodeURIComponent(item.id)}/resume.pdf">PDF</a><a class="button ghost compact" target="_blank" href="/exports/${encodeURIComponent(item.id)}/resume.html">HTML</a>` : ""}
          </div>
        </div>
      </article>`;
    }).join("");
  }

  async function loadHistory() {
    state.history = await api("/api/exports");
    renderHistory();
  }

  function renderGit() {
    const git = state.git;
    if (!git?.available) {
      elements.gitDetails.innerHTML = '<div class="empty-state">当前目录还不是 Git 仓库。</div>';
      elements.fetchButton.disabled = true;
      elements.pullButton.disabled = true;
      elements.pushButton.disabled = true;
      return;
    }
    elements.gitDetails.innerHTML = `
      <div class="git-row"><span>分支</span><strong>${escapeHtml(git.branch)}</strong></div>
      <div class="git-row"><span>Commit</span><strong>${escapeHtml(git.shortCommit)}</strong></div>
      <div class="git-row"><span>远程</span><strong>${escapeHtml(git.remote || "未配置 origin")}</strong></div>
      <div class="git-row"><span>同步</span><strong>领先 ${git.ahead} · 落后 ${git.behind}</strong></div>
      <div class="git-row"><span>工作区</span><strong>${git.dirty ? "有未提交变更" : "干净"}</strong></div>
      ${git.changes.length ? `<div class="git-changes">${escapeHtml(git.changes.join("\n"))}</div>` : ""}`;
    elements.fetchButton.disabled = !git.remote;
    elements.pullButton.disabled = !git.remote || git.dirty;
    elements.pushButton.disabled = !git.remote || git.behind > 0;
  }

  async function loadGit() {
    state.git = await api("/api/git/status");
    renderGit();
    updateStatus();
  }

  async function commitGit() {
    if (state.dirty) return showToast("请先保存配置，再创建 Git 版本");
    elements.commitButton.disabled = true;
    try {
      state.git = await api("/api/git/commit", { method: "POST", body: JSON.stringify({ message: elements.commitMessage.value }) });
      elements.commitMessage.value = "";
      renderGit();
      updateStatus();
      showToast("Git 版本已创建");
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.commitButton.disabled = false;
    }
  }

  async function syncGit(action, successMessage) {
    [elements.fetchButton, elements.pullButton, elements.pushButton].forEach((button) => { button.disabled = true; });
    try {
      state.git = await api(`/api/git/${action}`, { method: "POST", body: "{}" });
      renderGit();
      updateStatus();
      showToast(successMessage);
    } catch (error) {
      showToast(error.message);
      await loadGit().catch(() => {});
    }
  }

  async function exportCurrent() {
    elements.confirmExport.disabled = true;
    elements.confirmExport.textContent = "导出中…";
    try {
      const manifest = await api("/api/exports", {
        method: "POST",
        body: JSON.stringify({ config: state.config, label: elements.exportLabel.value }),
      });
      const saved = await api("/api/config");
      state.config = clone(saved);
      state.saved = clone(saved);
      clearDraft();
      elements.exportDialog.close();
      await Promise.all([loadHistory(), loadGit()]);
      updateStatus();
      showToast(`已导出：${manifest.id}`);
    } catch (error) {
      showValidation(error);
      showToast(error.message);
    } finally {
      elements.confirmExport.disabled = false;
      elements.confirmExport.textContent = "保存并导出";
    }
  }

  function setupDraft(config) {
    try {
      const draft = readDraft();
      if (draft?.config && canonical(draft.config) !== canonical(config)) elements.draftBanner.hidden = false;
    } catch (_) {
      clearDraft();
    }
  }

  function setupEvents() {
    elements.themeSelect.addEventListener("change", () => applyTheme(elements.themeSelect.value, true));
    themeQuery.addEventListener("change", () => {
      if (state.theme === "system") applyTheme("system");
    });
    elements.form.addEventListener("input", (event) => {
      const path = event.target.dataset.path;
      if (!path) return;
      setByPath(state.config, path, event.target.value);
      markChanged();
    });
    elements.form.addEventListener("change", (event) => {
      if (event.target.matches("[data-photo-upload]")) uploadPhoto(event.target);
    });
    elements.form.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (button && !button.disabled) handleAction(button);
    });
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      elements.tabs.dataset.activeTab = tab.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        const active = panel.id === `${tab.dataset.tab}-panel`;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
    }));
    elements.saveButton.addEventListener("click", () => saveConfig().catch(() => {}));
    elements.exportButton.addEventListener("click", () => elements.exportDialog.showModal());
    elements.zoomOut.addEventListener("click", () => applyPreviewZoom(state.previewZoom - PREVIEW_ZOOM_STEP));
    elements.zoomIn.addEventListener("click", () => applyPreviewZoom(state.previewZoom + PREVIEW_ZOOM_STEP));
    elements.zoomFit.addEventListener("click", fitPreview);
    elements.confirmExport.addEventListener("click", exportCurrent);
    elements.commitButton.addEventListener("click", commitGit);
    elements.fetchButton.addEventListener("click", () => syncGit("fetch", "远程状态已刷新"));
    elements.pullButton.addEventListener("click", () => syncGit("pull", "已快进同步远程版本"));
    elements.pushButton.addEventListener("click", () => syncGit("push", "当前版本已推送"));
    document.getElementById("refresh-history").addEventListener("click", loadHistory);
    elements.historyList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-history-action]");
      if (!button) return;
      if (button.dataset.historyAction === "diff") showDiff(button.dataset.id).catch((error) => showToast(error.message));
      if (button.dataset.historyAction === "restore") restoreExport(button.dataset.id).catch((error) => showToast(error.message));
    });
    document.getElementById("restore-draft").addEventListener("click", () => {
      const draft = readDraft();
      state.config = clone(draft.config);
      elements.draftBanner.hidden = true;
      renderEditor();
      markChanged();
    });
    document.getElementById("discard-draft").addEventListener("click", () => {
      clearDraft();
      elements.draftBanner.hidden = true;
    });
    elements.frame.addEventListener("load", () => {
      postPreview();
      requestAnimationFrame(fitPreview);
    });
    if (window.ResizeObserver) {
      const previewObserver = new ResizeObserver(() => {
        if (state.previewFit) fitPreview();
      });
      previewObserver.observe(elements.previewStage);
    } else {
      window.addEventListener("resize", () => {
        if (state.previewFit) fitPreview();
      });
    }
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== "resume:layout") return;
      state.overflow = event.data.overflow;
      setChip(elements.layoutStatus, state.overflow ? "内容超出 A4" : "A4 单页正常", state.overflow ? "danger" : "success");
      elements.exportButton.disabled = state.overflow;
    });
    window.addEventListener("keydown", (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        saveConfig().catch(() => {});
      }
      if (event.key.toLowerCase() === "e" && event.shiftKey) {
        event.preventDefault();
        elements.exportDialog.showModal();
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  async function initialize() {
    applyTheme(readTheme());
    setupEvents();
    try {
      const [config, templates] = await Promise.all([api("/api/config"), api("/api/templates")]);
      state.config = clone(config);
      state.saved = clone(config);
      state.templates = templates;
      setupDraft(config);
      renderEditor();
      postPreview();
      await Promise.all([loadHistory(), loadGit()]);
      updateStatus();
    } catch (error) {
      showToast(error.message);
      setChip(elements.saveStatus, "载入失败", "danger");
    }
  }

  initialize();
})();
