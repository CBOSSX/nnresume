const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const directories = ["bin", "lib", "scripts", "templates", "test"];
const files = ["server.js", "editor.js", "resume-renderer.js", "cli-export.js"];

function collect(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(target);
    return entry.name.endsWith(".js") ? [target] : [];
  });
}

directories.forEach((directory) => files.push(...collect(path.join(root, directory))));
files.forEach((file) => execFileSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" }));
process.stdout.write(`Syntax checked ${files.length} JavaScript files.\n`);
