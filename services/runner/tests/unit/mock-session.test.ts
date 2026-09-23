import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, it } from "vitest";

import {
  createMockSession,
  wrapMockSandbox,
} from "../../src/engines/sandbox_agent/mock-session.ts";
import { openSession } from "../../src/environment/harness-session-lifecycle.ts";

describe("createMockSession", () => {
  it("replays 'reply' through onEvent and resolves prompt() with end_turn", async () => {
    const session = createMockSession("sess-1", {
      behavior: "reply",
      kwargs: { text: "hello" },
    });
    const events: unknown[] = [];
    session.onEvent((event) => events.push(event));

    const result = await session.prompt([]);

    assert.deepEqual(result, { stopReason: "end_turn" });
    assert.deepEqual(events, [
      {
        payload: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
          },
        },
      },
    ]);
  });

  it("parks 'approval' until respondPermission answers the gate", async () => {
    const session = createMockSession("sess-2", {
      behavior: "approval",
      kwargs: { tool: "delete_file" },
    });
    let permissionRequest: any;
    session.onPermissionRequest((req) => {
      permissionRequest = req;
    });

    const promptPromise = session.prompt([]);
    await Promise.resolve();
    assert.ok(permissionRequest, "onPermissionRequest must fire");
    assert.deepEqual(permissionRequest.availableReplies, ["once", "reject"]);

    let settled = false;
    promptPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false, "prompt() must not resolve before the gate is answered");

    await session.respondPermission(permissionRequest.id, "once");
    const result = await promptPromise;
    assert.deepEqual(result, { stopReason: "end_turn" });
  });

  it("setModel never rejects (no network call, no provider key needed)", async () => {
    const session = createMockSession("sess-3", { behavior: "reply", kwargs: { text: "x" } });
    await session.setModel("placeholder/mock-model");
  });

  it("fails the turn for 'error'", async () => {
    const session = createMockSession("sess-4", {
      behavior: "error",
      kwargs: { message: "synthetic failure" },
    });
    await assert.rejects(() => session.prompt([]), /synthetic failure/);
  });
});

describe("wrapMockSandbox", () => {
  let cwd: string;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
  });

  it("overrides the session-opening calls, leaving every other member real", async () => {
    cwd = mkdtempSync(join(tmpdir(), "agenta-mock-sandbox-"));
    mkdirSync(join(cwd, ".agenta"), { recursive: true });
    writeFileSync(
      join(cwd, ".agenta", "mock.json"),
      JSON.stringify({ behavior: "reply", kwargs: { text: "wrapped" } }),
      "utf-8",
    );

    const calls: string[] = [];
    const realSandbox = {
      async mkdirFs() {
        calls.push("mkdirFs");
      },
      async getAgent() {
        calls.push("getAgent");
        throw new Error("daemon does not know agent 'mock'");
      },
    };

    const wrapped = wrapMockSandbox(realSandbox, false);
    // Real members pass through untouched.
    await wrapped.mkdirFs();
    await assert.rejects(() => wrapped.getAgent(), /does not know agent/);
    assert.deepEqual(calls, ["mkdirFs", "getAgent"]);

    const session = await wrapped.createSession({ id: "sess-5", cwd });
    const events: unknown[] = [];
    session.onEvent((event: unknown) => events.push(event));
    const result = await session.prompt([]);
    assert.deepEqual(result, { stopReason: "end_turn" });
    assert.equal(session.id, "sess-5");
  });

  it("fails the createSession call when the mock config is missing", async () => {
    cwd = mkdtempSync(join(tmpdir(), "agenta-mock-sandbox-"));
    const wrapped = wrapMockSandbox({}, false);
    await assert.rejects(
      () => wrapped.createSession({ id: "sess-6", cwd }),
      /mock harness config not found/,
    );
  });

  // Live bug: a channel turn never parks (its caller hangs up), so the next turn is cold and holds
  // the finished turn's `mock-native-*` id. The unwrapped resume reached the daemon, which has no
  // `mock` agent to spawn, and the turn hung before create_session.
  it("opens a cold follow-up turn fresh instead of resuming through the daemon", async () => {
    cwd = mkdtempSync(join(tmpdir(), "agenta-mock-sandbox-"));
    mkdirSync(join(cwd, ".agenta"), { recursive: true });
    writeFileSync(
      join(cwd, ".agenta", "mock.json"),
      JSON.stringify({ behavior: "reply", kwargs: { text: "second" } }),
      "utf-8",
    );
    const daemonCalls: string[] = [];
    const realSandbox = {
      async resumeSession() {
        daemonCalls.push("resumeSession");
        return new Promise(() => {});
      },
      async createSession() {
        daemonCalls.push("createSession");
        return new Promise(() => {});
      },
    };
    const logs: string[] = [];

    const opened = await openSession({
      sandbox: wrapMockSandbox(realSandbox, false),
      persist: { updateSession: async () => undefined },
      acpAgent: "mock",
      harness: "mock",
      cwd,
      sessionInit: {},
      priorAgentSessionId: "mock-native-sess-7:mock",
      nativeHistoryDurable: false,
      localSessionId: "sess-7:mock",
      continuitySessionKey: "sess-7",
      log: (line: string) => logs.push(line),
      timingLog: () => {},
    } as never);

    assert.deepEqual(daemonCalls, [], "no session call may reach the daemon for the mock");
    assert.equal(opened.mode, "create");
    assert.equal(opened.loadedFromContinuity, false);
    assert.equal(opened.session.id, "sess-7:mock");
    assert.ok(logs.some((line) => /keeps no native session/.test(line)));
  });
});
