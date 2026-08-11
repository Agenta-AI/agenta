/**
 * End-to-end proof that `harness: "mock"` is reachable through the real acquire/run-turn path:
 * `run-plan.ts` maps it straight through (no `pi_*` alias), `environment.ts` wraps the acquired
 * sandbox's `createSession`, and `run-turn.ts`/`pause.ts` drive the turn exactly as for any real
 * harness. Only the sandbox handle and the OTel tracer are faked here (network/subprocess seams);
 * everything else — run-plan, workspace materialization, the permission responder, the pause
 * controller — is the real code.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";

import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  runSandboxAgent,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";

beforeEach(() => {
  resetRunnerConfigCache();
});

afterEach(() => {
  resetRunnerConfigCache();
});

/** A bare-bones real-shaped sandbox: `getAgent` fails the way a real daemon would for an
 *  unregistered agent name, so the capability probe falls back to its static guess. */
function fakeSandbox() {
  const calls = { mkdirFs: [] as string[], destroySandbox: 0, dispose: 0 };
  return {
    calls,
    sandbox: {
      async mkdirFs({ path }: { path: string }) {
        calls.mkdirFs.push(path);
      },
      async getAgent() {
        throw new Error("daemon does not know agent 'mock'");
      },
      async destroySandbox() {
        calls.destroySandbox += 1;
      },
      async dispose() {
        calls.dispose += 1;
      },
    },
  };
}

function fakeRun() {
  const handledUpdates: unknown[] = [];
  const events: unknown[] = [];
  const run = {
    start() {},
    handleUpdate(update: unknown) {
      handledUpdates.push(update);
    },
    emitEvent(event: unknown) {
      events.push(event);
    },
    usage() {
      return undefined;
    },
    setUsage() {},
    finish(stopReason?: string) {
      return stopReason ?? "";
    },
    recordError() {},
    output() {
      return "";
    },
    async flush() {},
    events() {
      return events as never[];
    },
    settleOpenToolCalls() {},
    openToolCallIds() {
      return [];
    },
    traceId() {
      return "trace-mock";
    },
  };
  return { run, handledUpdates, events };
}

function baseDeps(
  sandbox: unknown,
  run: unknown,
  permissionDecision: "allow" | "deny" | "pendingApproval" = "allow",
): SandboxAgentDeps {
  return {
    buildSandboxProvider: () => ({ provider: true }) as never,
    startSandboxAgent: (async () => sandbox) as never,
    createOtel: (() => run) as never,
    probeCapabilities: (async () => ({
      source: "static",
      capabilities: {
        textMessages: true,
        images: false,
        fileAttachments: false,
        mcpTools: true,
        toolCalls: true,
        reasoning: true,
        planMode: true,
        permissions: true,
        streamingDeltas: true,
        sessionLifecycle: true,
        usage: true,
      },
    })) as never,
    responderFactory: () => ({
      async onPermission() {
        return { kind: permissionDecision } as never;
      },
      async onClientTool() {
        return { kind: "deny" } as never;
      },
    }),
  };
}

function mockRequest(
  behavior: string,
  kwargs: Record<string, unknown>,
): AgentRunRequest {
  return {
    harness: "mock",
    // Obvious placeholder: the mock makes no network call, so no real model/provider is needed.
    model: "mock-provider/mock-model",
    messages: [{ role: "user", content: "go" }],
    harnessFiles: [
      { path: ".agenta/mock.json", content: JSON.stringify({ behavior, kwargs }) },
    ],
  };
}

describe("harness: mock, end to end", () => {
  it("runs 'reply' through the real workspace + run-turn path", async () => {
    const { sandbox } = fakeSandbox();
    const { run, handledUpdates } = fakeRun();

    const result = await runSandboxAgent(
      mockRequest("reply", { text: "hello from mock" }),
      undefined,
      undefined,
      baseDeps(sandbox, run),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(handledUpdates, [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello from mock" } },
    ]);
  });

  it("runs 'tool' end to end with the announce/complete/reply shapes", async () => {
    const { sandbox } = fakeSandbox();
    const { run, handledUpdates } = fakeRun();

    const result = await runSandboxAgent(
      mockRequest("tool", { tool: "search", text: "found it" }),
      undefined,
      undefined,
      baseDeps(sandbox, run),
    );

    assert.equal(result.ok, true);
    assert.equal((handledUpdates[0] as any).sessionUpdate, "tool_call");
    assert.equal((handledUpdates[1] as any).sessionUpdate, "tool_call_update");
    assert.equal((handledUpdates[2] as any).content.text, "found it");
  });

  it("parks on 'approval' via the real PendingApprovalPauseController", async () => {
    const { sandbox } = fakeSandbox();
    const { run } = fakeRun();

    const result = await runSandboxAgent(
      mockRequest("approval", { tool: "delete_file" }),
      undefined,
      undefined,
      baseDeps(sandbox, run, "pendingApproval"),
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.stopReason, "paused");
  });

  it("fails the turn for 'error' with the given message", async () => {
    const { sandbox } = fakeSandbox();
    const { run } = fakeRun();

    const result = await runSandboxAgent(
      mockRequest("error", { message: "synthetic mock failure" }),
      undefined,
      undefined,
      baseDeps(sandbox, run),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error ?? "", /synthetic mock failure/);
  });

  it("fails loud when .agenta/mock.json is absent, never falling back to a default behaviour", async () => {
    const { sandbox } = fakeSandbox();
    const { run } = fakeRun();

    const request: AgentRunRequest = {
      harness: "mock",
      model: "mock-provider/mock-model",
      messages: [{ role: "user", content: "go" }],
    };

    const result = await runSandboxAgent(
      request,
      undefined,
      undefined,
      baseDeps(sandbox, run),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error ?? "", /mock harness config not found/);
  });

  it("fails loud when .agenta/mock.json names an unknown behaviour", async () => {
    const { sandbox } = fakeSandbox();
    const { run } = fakeRun();

    const result = await runSandboxAgent(
      mockRequest("not-a-real-behaviour", {}),
      undefined,
      undefined,
      baseDeps(sandbox, run),
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error ?? "", /unknown behaviour/);
  });
});
