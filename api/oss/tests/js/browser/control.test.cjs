"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { load } = require("./lib.cjs");
const { createSession } = load("browser");
const { USER_IDLE_MS } = load("config");

const session = () => createSession({ stateFile: "/tmp/agenta-browser-test-state.json", waits: {} });

test("a person who just took control blocks the agent", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const s = session();
  s.setControl("user");
  assert.equal(s.personActive(), true);
});

test("control held with no input stops blocking the agent", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const s = session();
  s.setControl("user");
  t.mock.timers.tick(USER_IDLE_MS);
  assert.equal(s.personActive(), false);
});

test("every input keeps the person's control fresh", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const s = session();
  s.setControl("user");
  t.mock.timers.tick(USER_IDLE_MS - 1);
  s.noteInput();
  t.mock.timers.tick(USER_IDLE_MS - 1);
  assert.equal(s.personActive(), true);
});

test("nobody blocks the agent while the agent has control", () => {
  assert.equal(session().personActive(), false);
});
