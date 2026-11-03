"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { SCRIPTS } = require("./lib.cjs");

const LOCK = path.join(SCRIPTS, "lib", "lock.cjs");

function racer(file, holdMs) {
  const code = `const {tryLock}=require(${JSON.stringify(LOCK)});const got=tryLock(${JSON.stringify(file)});process.stdout.write(String(got));setTimeout(()=>{},${holdMs});`;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", code]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", () => resolve(out));
  });
}

test("of eight processes racing for the lock, exactly one gets it", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-lock-")), "start.lock");
  const results = await Promise.all(Array.from({ length: 8 }, () => racer(file, 500)));
  assert.equal(results.filter((r) => r === "true").length, 1, results.join(","));
});

test("a lock whose owner died is taken over", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-lock-")), "start.lock");
  assert.equal(await racer(file, 0), "true");
  // The owner exited without releasing.
  assert.equal(fs.existsSync(file), true);
  const results = await Promise.all(Array.from({ length: 4 }, () => racer(file, 300)));
  assert.equal(results.filter((r) => r === "true").length, 1, results.join(","));
});
