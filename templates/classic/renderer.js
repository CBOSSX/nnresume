(function registerClassicTemplate() {
  "use strict";

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function richText(node, text) {
    String(text).split("**").forEach((part, index) => {
      node.appendChild(index % 2 ? element("strong", "", part) : document.createTextNode(part));
    });
  }

  function header(config) {
    const node = element("header", "hero");
    const identity = element("div", "hero-identity");
    identity.append(element("h1", "", config.basics.name), element("p", "role", config.basics.title));
    const contact = element("ul", "contact");
    [["手机", config.basics.phone, `tel:${config.basics.phone}`], ["邮箱", config.basics.email, `mailto:${config.basics.email}`]].forEach(([label, value, href]) => {
      const item = element("li");
      const link = element("a", "", value);
      link.href = href;
      item.append(element("span", "", label), link);
      contact.appendChild(item);
    });
    identity.appendChild(contact);
    node.appendChild(identity);
    if (config.basics.photo) {
      const photo = element("img", "profile-photo");
      photo.src = config.basics.photo;
      photo.alt = `${config.basics.name}的照片`;
      node.appendChild(photo);
    }
    return node;
  }

  function education(config) {
    const section = element("section", "section education");
    section.appendChild(element("h2", "", "教育经历"));
    config.education.forEach((item) => {
      const row = element("div", "education-line");
      const details = element("div", "education-details");
      details.append(element("h3", "", item.school), element("p", "", `${item.major} · ${item.degree}`));
      row.append(details, element("span", "education-date", item.date));
      section.appendChild(row);
    });
    return section;
  }

  function skills(config) {
    const section = element("section", "section skills");
    section.appendChild(element("h2", "", "核心技能"));
    const list = element("dl", "skill-list");
    config.skills.forEach((skill) => {
      const row = element("div");
      row.append(element("dt", "", skill.category), element("dd", "", skill.items));
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  function project(item, first) {
    const node = element("div", first ? "project first-project" : "project");
    const title = element("div", "project-title");
    title.appendChild(element("h3", "", item.name));
    if (item.tag) title.appendChild(element("span", "", item.tag));
    node.append(title, element("p", "project-intro", item.intro));
    const bullets = element("ul", "impact-list");
    item.bullets.forEach((text) => {
      const bullet = element("li");
      richText(bullet, text);
      bullets.appendChild(bullet);
    });
    node.appendChild(bullets);
    return node;
  }

  function experience(config) {
    const section = element("section", "section experience");
    section.appendChild(element("h2", "", "工作经历"));
    config.experiences.forEach((item, experienceIndex) => {
      const entry = element("div", experienceIndex ? "experience-entry" : "experience-entry first");
      const company = element("div", "company-line");
      const details = element("div");
      details.append(element("h3", "", item.company), element("p", "", item.role));
      company.append(details, element("span", "", item.date));
      entry.appendChild(company);
      item.projects.forEach((value, index) => entry.appendChild(project(value, index === 0)));
      section.appendChild(entry);
    });
    return section;
  }

  function render(root, config) {
    const page = element("article", "page page-one");
    page.append(header(config), education(config), skills(config), experience(config));
    const footer = element("footer", "page-footer");
    footer.append(element("span", "", config.footer), element("span", "", "1 / 1"));
    page.appendChild(footer);
    root.replaceChildren(page);
  }

  window.NNRESUME_TEMPLATES = window.NNRESUME_TEMPLATES || {};
  window.NNRESUME_TEMPLATES.classic = { render };
})();
