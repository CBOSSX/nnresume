const fs = require("fs");
const path = require("path");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function migrateConfig(input) {
  const config = clone(input);
  if (config?.schemaVersion === 1 && config.experience) {
    config.schemaVersion = 2;
    config.basics = { ...config.basics, photo: config.basics?.photo || "assets/profile.png" };
    config.experiences = [config.experience];
    delete config.experience;
  }
  if (config?.schemaVersion === 2) {
    config.schemaVersion = 3;
    config.template = config.template || "classic";
  }
  return config;
}

function validateConfig(config) {
  const errors = [];
  const requiredText = (value, field) => {
    if (typeof value !== "string" || !value.trim()) {
      errors.push({ path: field, message: "不能为空" });
    }
  };

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, errors: [{ path: "$", message: "配置必须是对象" }] };
  }
  if (config.schemaVersion !== 3) {
    errors.push({ path: "schemaVersion", message: "仅支持版本 3" });
  }
  if (typeof config.template !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(config.template)) {
    errors.push({ path: "template", message: "模板 ID 格式不正确" });
  }

  requiredText(config.basics?.name, "basics.name");
  requiredText(config.basics?.title, "basics.title");
  requiredText(config.basics?.phone, "basics.phone");
  requiredText(config.basics?.email, "basics.email");
  if (typeof config.basics?.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.basics.email)) {
    errors.push({ path: "basics.email", message: "邮箱格式不正确" });
  }
  if (typeof config.basics?.phone === "string" && !/^[+\d][\d\s-]{6,19}$/.test(config.basics.phone)) {
    errors.push({ path: "basics.phone", message: "手机号格式不正确" });
  }
  if (typeof config.basics?.photo !== "string") {
    errors.push({ path: "basics.photo", message: "必须是字符串" });
  } else if (config.basics.photo && !/^assets\/[\w.-]+\.(png|jpe?g|webp)$/i.test(config.basics.photo)) {
    errors.push({ path: "basics.photo", message: "照片必须位于 assets/，且为 PNG、JPEG 或 WebP" });
  }

  if (!Array.isArray(config.education) || config.education.length === 0) {
    errors.push({ path: "education", message: "至少需要一条教育经历" });
  } else {
    config.education.forEach((item, index) => {
      ["school", "major", "degree", "date"].forEach((field) => {
        requiredText(item?.[field], `education.${index}.${field}`);
      });
    });
  }

  if (!Array.isArray(config.skills) || config.skills.length === 0) {
    errors.push({ path: "skills", message: "至少需要一个技能分组" });
  } else {
    config.skills.forEach((item, index) => {
      requiredText(item?.category, `skills.${index}.category`);
      requiredText(item?.items, `skills.${index}.items`);
    });
  }

  if (!Array.isArray(config.experiences) || config.experiences.length === 0) {
    errors.push({ path: "experiences", message: "至少需要一段工作经历" });
  } else {
    config.experiences.forEach((experience, experienceIndex) => {
      ["company", "role", "date"].forEach((field) => {
        requiredText(experience?.[field], `experiences.${experienceIndex}.${field}`);
      });
      const projects = experience?.projects;
      if (!Array.isArray(projects) || projects.length === 0) {
        errors.push({ path: `experiences.${experienceIndex}.projects`, message: "至少需要一个项目" });
      } else {
        projects.forEach((project, projectIndex) => {
          const base = `experiences.${experienceIndex}.projects.${projectIndex}`;
          requiredText(project?.name, `${base}.name`);
          if (typeof project?.tag !== "string") {
            errors.push({ path: `${base}.tag`, message: "必须是字符串" });
          }
          requiredText(project?.intro, `${base}.intro`);
          if (!Array.isArray(project?.bullets) || project.bullets.length === 0) {
            errors.push({ path: `${base}.bullets`, message: "至少需要一个项目要点" });
          } else {
            project.bullets.forEach((bullet, bulletIndex) => {
              requiredText(bullet, `${base}.bullets.${bulletIndex}`);
            });
          }
        });
      }
    });
  }
  requiredText(config.footer, "footer");
  return { valid: errors.length === 0, errors };
}

function readConfig(root) {
  return migrateConfig(JSON.parse(fs.readFileSync(path.join(root, "resume.json"), "utf8")));
}

function writeConfigAtomic(root, input, options = {}) {
  const config = migrateConfig(input);
  if (options.touch !== false) config.updatedAt = new Date().toISOString();
  const validation = validateConfig(config);
  if (!validation.valid) {
    const error = new Error("配置校验失败");
    error.statusCode = 400;
    error.validationErrors = validation.errors;
    throw error;
  }

  const target = path.join(root, "resume.json");
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return config;
}

module.exports = { clone, migrateConfig, readConfig, validateConfig, writeConfigAtomic };
