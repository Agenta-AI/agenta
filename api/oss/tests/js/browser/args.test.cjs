"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./lib.cjs");

const { parseArgs, request } = load("cli");

const line = (command, ...argv) => request(command, parseArgs(argv));

test("type keeps text after -- even when it starts with --", () => {
  assert.deepEqual(line("type", "e8", "--submit", "--", "--verbose", "flag"), [
    "/op",
    { op: "type", args: { ref: "e8", role: undefined, name: undefined, text: "--verbose flag", submit: true, intent: undefined } },
  ]);
});

test("an unknown --word is text, not a flag that eats the next word", () => {
  assert.deepEqual(parseArgs(["e8", "--not-a-flag", "hello"]), {
    positional: ["e8", "--not-a-flag", "hello"],
    flags: {},
  });
});

test("role and name select the target; the rest is the value", () => {
  assert.deepEqual(line("set", "--role", "combobox", "--name", "Country", "Germany", "--intent", "pay"), [
    "/op",
    { op: "form_input", args: { ref: undefined, role: "combobox", name: "Country", value: "Germany", intent: "pay" } },
  ]);
});

test("read --interactive and wait and tab", () => {
  assert.deepEqual(line("read", "--interactive"), ["/op", { op: "read_page", args: { ref: undefined, filter: "interactive" } }]);
  assert.deepEqual(line("wait", "Please", "sign", "in"), ["/wait", { reason: "Please sign in" }]);
  assert.deepEqual(line("tab", "2"), ["/op", { op: "tab", args: { index: "2" } }]);
  assert.equal(line("dance"), null);
});
