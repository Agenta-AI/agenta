"use strict";

const path = require("node:path");

const SCRIPTS = path.resolve(__dirname, "../../../src/core/browser/skill/scripts");

module.exports = {
  SCRIPTS,
  ENTRY: path.join(SCRIPTS, "agenta-browser.cjs"),
  load: (name) => require(path.join(SCRIPTS, "lib", `${name}.cjs`)),
};
