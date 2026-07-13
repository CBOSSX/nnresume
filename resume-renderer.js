(function resumeLoader() {
  "use strict";

  const root = document.getElementById("resume-root");
  const loadedScripts = new Map();
  let templates;

  function reportLayout() {
    requestAnimationFrame(() => {
      const page = document.querySelector(".page");
      if (!page) return;
      const status = {
        type: "resume:layout",
        overflow: page.scrollHeight > page.clientHeight,
        clientHeight: page.clientHeight,
        scrollHeight: page.scrollHeight,
      };
      window.__RESUME_LAYOUT__ = status;
      if (window.parent !== window) window.parent.postMessage(status, window.location.origin);
    });
  }

  async function getTemplates() {
    if (window.__NNRESUME_TEMPLATE__) return [window.__NNRESUME_TEMPLATE__];
    if (!templates) {
      const response = await fetch("/api/templates");
      if (!response.ok) throw new Error("模板列表读取失败");
      templates = await response.json();
    }
    return templates;
  }

  function loadScript(id) {
    window.NNRESUME_TEMPLATES = window.NNRESUME_TEMPLATES || {};
    if (window.NNRESUME_TEMPLATES[id]) return Promise.resolve();
    if (loadedScripts.has(id)) return loadedScripts.get(id);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `/templates/${id}/renderer.js`;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`模板脚本载入失败：${id}`));
      document.head.appendChild(script);
    });
    loadedScripts.set(id, promise);
    return promise;
  }

  function loadStyles(id) {
    const link = document.getElementById("template-style");
    if (!link || window.__NNRESUME_TEMPLATE__) return Promise.resolve();
    const href = `/templates/${id}/styles.css`;
    if (link.getAttribute("href") === href) return Promise.resolve();
    return new Promise((resolve, reject) => {
      link.onload = resolve;
      link.onerror = () => reject(new Error(`模板样式载入失败：${id}`));
      link.href = href;
    });
  }

  async function render(config) {
    if (!root || !config) return;
    const available = await getTemplates();
    if (!available.some((item) => item.id === config.template)) {
      throw new Error(`模板不存在：${config.template}`);
    }
    await Promise.all([loadStyles(config.template), loadScript(config.template)]);
    const renderer = window.NNRESUME_TEMPLATES?.[config.template];
    if (!renderer?.render) throw new Error(`模板接口无效：${config.template}`);
    renderer.render(root, config);
    reportLayout();
  }

  async function loadInitialConfig() {
    if (window.__RESUME_CONFIG__) return window.__RESUME_CONFIG__;
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("配置读取失败");
    return response.json();
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.type === "resume:preview" && event.data.config) {
      render(event.data.config).catch((error) => {
        if (root) root.textContent = error.message;
      });
    }
  });

  loadInitialConfig().then(render).catch((error) => {
    if (root) root.textContent = error.message;
  });
})();
