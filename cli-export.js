const { run } = require("./lib/cli");

run(["export", process.cwd(), ...process.argv.slice(2)]).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
