"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load } = require("./lib.cjs");

const { MAX_SAVED_ITEM_CHARS, stateStore } = load("state");

const cookie = (name, domain, value) => ({ name, domain, path: "/", value, expires: -1, httpOnly: true, secure: true, sameSite: "Lax" });
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-state-"));
  return path.join(dir, ".agenta-browser", "state.json");
}

test("two browsers keep each other's sign-ins, and a logout stays gone", () => {
  const file = tempFile();
  const a = stateStore(file);
  const b = stateStore(file);

  assert.equal(a.save({ cookies: [cookie("sid", "github.com", "a1")], origins: [] }), true);
  assert.equal(b.save({ cookies: [cookie("sid", "linear.app", "b1")], origins: [{ origin: "https://linear.app", localStorage: [{ name: "t", value: "1" }] }] }), true);
  assert.deepEqual(read(file), {
    cookies: [cookie("sid", "github.com", "a1"), cookie("sid", "linear.app", "b1")],
    origins: [{ origin: "https://linear.app", localStorage: [{ name: "t", value: "1" }] }],
  });

  // A logs out of github.com; B, which never touched github.com, saves again afterwards.
  assert.equal(a.save({ cookies: [], origins: [] }), true);
  assert.equal(b.save({ cookies: [cookie("sid", "linear.app", "b2")], origins: [{ origin: "https://linear.app", localStorage: [{ name: "t", value: "1" }] }] }), true);
  assert.deepEqual(read(file), {
    cookies: [cookie("sid", "linear.app", "b2")],
    origins: [{ origin: "https://linear.app", localStorage: [{ name: "t", value: "1" }] }],
  });
});

test("a browser that loaded an old sign-in and did not change it does not overwrite a newer one", () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cookies: [cookie("sid", "github.com", "old")], origins: [] }));
  const a = stateStore(file);
  const b = stateStore(file);
  b.save({ cookies: [cookie("sid", "github.com", "new")], origins: [] });
  assert.equal(a.save({ cookies: [cookie("sid", "github.com", "old"), cookie("x", "a.com", "1")], origins: [] }), true);
  assert.deepEqual(read(file).cookies, [cookie("sid", "github.com", "new"), cookie("x", "a.com", "1")]);
});

test("nothing changed: no write", () => {
  const file = tempFile();
  const a = stateStore(file);
  assert.equal(a.save({ cookies: [], origins: [] }), false);
  assert.equal(fs.existsSync(file), false);
});

test("a command run from a subfolder saves sign-ins in the agent's shared folder", () => {
  const { defaultStateFile } = load("config");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agenta-browser-cwd-")));
  fs.mkdirSync(path.join(root, "agent-files"));
  fs.mkdirSync(path.join(root, "project", "src"), { recursive: true });
  const expected = path.join(root, "agent-files", ".agenta-browser", "state.json");
  assert.equal(defaultStateFile(root), expected);
  assert.equal(defaultStateFile(path.join(root, "project", "src")), expected);
});

test("a save keeps cookies and small entries and drops cache-sized ones", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agenta-state-")), "state.json");
  const token = { name: "auth", value: "t".repeat(8_000) };
  const cache = { name: "modules", value: "c".repeat(MAX_SAVED_ITEM_CHARS + 1) };
  stateStore(file).save({
    cookies: [{ name: "sid", value: "s".repeat(4_000), domain: "a.test", path: "/" }],
    origins: [
      { origin: "https://a.test", localStorage: [token, cache] },
      { origin: "https://cache.test", localStorage: [cache] },
    ],
  });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.cookies.length, 1);
  assert.deepEqual(saved.origins, [{ origin: "https://a.test", localStorage: [token] }]);
});

test("a file that already holds a large entry shrinks on the next save", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agenta-state-")), "state.json");
  const cache = { name: "modules", value: "c".repeat(MAX_SAVED_ITEM_CHARS + 1) };
  const old = { cookies: [], origins: [{ origin: "https://a.test", localStorage: [cache] }] };
  fs.writeFileSync(file, JSON.stringify(old));
  stateStore(file).save(old);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).origins, []);
});

test("a change only in a dropped entry writes nothing", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agenta-state-")), "state.json");
  const store = stateStore(file);
  const withCache = (fill) => ({
    cookies: [{ name: "sid", value: "s", domain: "a.test", path: "/" }],
    origins: [{ origin: "https://a.test", localStorage: [{ name: "m", value: fill.repeat(MAX_SAVED_ITEM_CHARS + 1) }] }],
  });
  assert.equal(store.save(withCache("a")), true);
  assert.equal(store.save(withCache("b")), false);
});
