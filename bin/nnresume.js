#!/usr/bin/env node
const { run } = require("../lib/cli");

run(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  if (error.validationErrors) process.stderr.write(`${JSON.stringify(error.validationErrors, null, 2)}\n`);
  process.exitCode = 1;
});
