#!/usr/bin/env node
// agenta-browser: one Chromium that an agent drives from its shell, inside its own session sandbox.
// The first command starts the browser server; later commands talk to it. The same server serves
// the live view, so a person can watch the page and take control.
"use strict";

const path = require("node:path");
const { main } = require(path.join(__dirname, "lib", "cli.cjs"));

main(process.argv.slice(2), __filename).catch((e) => {
  console.error(String(e.message || e));
  process.exit(1);
});
