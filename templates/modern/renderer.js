(function registerModernTemplate() {
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

  function sectionTitle(text) {
    return element("h2", "modern-section-title", text);
  }

  function sidebar(config) {
    const side = element("aside", "modern-sidebar");
    if (config.basics.photo) {
      const photo = element("img", "profile-photo");
      photo.src = config.basics.photo;
      photo.alt = `${config.basics.name}的照片`;
      side.appendChild(photo);
    }
    side.appendChild(sectionTitle("联系我"));
    const contact = element("div", "modern-contact");
    contact.append(element("span", "", config.basics.phone), element("span", "", config.basics.email));
    side.appendChild(contact);
    side.appendChild(sectionTitle("核心技能"));
    config.skills.forEach((skill) => {
      const group = element("div", "modern-skill");
      group.append(element("h3", "", skill.category), element("p", "", skill.items));
      side.appendChild(group);
    });
    side.appendChild(sectionTitle("教育经历"));
    config.education.forEach((item) => {
      const education = element("div", "modern-education");
      education.append(element("h3", "", item.school), element("p", "", `${item.major} · ${item.degree}`), element("span", "", item.date));
      side.appendChild(education);
    });
    return side;
  }

  function project(item) {
    const node = element("article", "modern-project");
    const heading = element("div", "modern-project-heading");
    heading.appendChild(element("h4", "", item.name));
    if (item.tag) heading.appendChild(element("span", "", item.tag));
    node.append(heading, element("p", "modern-project-intro", item.intro));
    const bullets = element("ul", "modern-impact-list");
    item.bullets.forEach((text) => {
      const bullet = element("li");
      richText(bullet, text);
      bullets.appendChild(bullet);
    });
    node.appendChild(bullets);
    return node;
  }

  function main(config) {
    const main = element("main", "modern-main");
    const hero = element("header", "modern-hero");
    hero.append(element("p", "modern-eyebrow", "RESUME"), element("h1", "", config.basics.name), element("p", "modern-role", config.basics.title));
    main.append(hero, sectionTitle("工作经历"));
    config.experiences.forEach((item) => {
      const entry = element("section", "modern-experience");
      const company = element("div", "modern-company");
      const identity = element("div");
      identity.append(element("h3", "", item.company), element("p", "", item.role));
      company.append(identity, element("span", "", item.date));
      entry.appendChild(company);
      item.projects.forEach((value) => entry.appendChild(project(value)));
      main.appendChild(entry);
    });
    return main;
  }

  function render(root, config) {
    const page = element("article", "page modern-page");
    page.append(sidebar(config), main(config));
    const footer = element("footer", "page-footer");
    footer.append(element("span", "", config.footer), element("span", "", "1 / 1"));
    page.appendChild(footer);
    root.replaceChildren(page);
  }

  window.NNRESUME_TEMPLATES = window.NNRESUME_TEMPLATES || {};
  window.NNRESUME_TEMPLATES.modern = { render };
})();
