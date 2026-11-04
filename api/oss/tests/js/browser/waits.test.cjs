"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { load } = require("./lib.cjs");

const { createWaits } = load("waits");
const { createSession } = load("browser");
const { createLiveView } = load("live-view");

function setup({ sliceMs = 150, totalMs = 10_000 } = {}) {
  let session;
  const waits = createWaits({ sliceMs, totalMs, onChange: () => session.emit("status") });
  session = createSession({ stateFile: path.join(os.tmpdir(), "agenta-browser-unused.json"), waits });
  const live = createLiveView(session);
  const viewer = () => {
    const ws = Object.assign(new EventEmitter(), { readyState: 1, sent: [], send(text) { this.sent.push(JSON.parse(text)); } });
    live.attachViewer(ws);
    return ws;
  };
  const say = (ws, message) => ws.emit("message", Buffer.from(JSON.stringify(message)));
  return { session, waits, viewer, say };
}

test("the person clicking I'm done ends the wait and gives control to the agent", async () => {
  const { session, waits, viewer, say } = setup({ sliceMs: 5_000 });
  const ws = viewer();
  const outcome = waits.wait("Please sign in");
  say(ws, { type: "control", take: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(session.control, "user");
  say(ws, { type: "done" });
  assert.equal(await outcome, "done");
  assert.equal(session.control, "agent");
  assert.equal(waits.reason(), "");
});

test("giving control back or closing the view does not end the wait", async () => {
  const { session, waits, viewer, say } = setup({ sliceMs: 150 });
  const ws = viewer();
  const outcome = waits.wait("Please sign in");
  say(ws, { type: "control", take: true });
  say(ws, { type: "control", take: false });
  ws.emit("close");
  assert.equal(await outcome, "still");
  assert.equal(session.control, "agent");
  assert.equal(waits.reason(), "Please sign in");
  assert.equal(waits.pendingCount(), 0);
});

test("the live view shows the open reason between wait calls", async () => {
  const { waits, viewer } = setup({ sliceMs: 50 });
  assert.equal(await waits.wait("Solve the CAPTCHA"), "still");
  const ws = viewer();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(ws.sent.find((m) => m.type === "status"), { type: "status", control: "agent", waiting: "Solve the CAPTCHA", url: "", title: "", tabs: [] });
});

test("a reason expires after its total time, counted from the first wait", async () => {
  const { waits } = setup({ sliceMs: 100, totalMs: 160 });
  assert.equal(await waits.wait("Sign in"), "still");
  assert.equal(await waits.wait("Sign in"), "expired");
  assert.equal(waits.reason(), "");
  assert.equal(waits.active(), false);
  // Answered once; asking again starts a new window instead of failing forever.
  assert.equal(await waits.wait("Sign in"), "still");
});

test("I'm done clicked between two wait calls answers the next wait", async () => {
  const { waits, viewer, say } = setup({ sliceMs: 50 });
  assert.equal(await waits.wait("Please sign in"), "still");
  say(viewer(), { type: "done" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(waits.reason(), "");
  assert.equal(await waits.wait("Please sign in"), "done");
  assert.equal(await waits.wait("Please sign in"), "still");
});
