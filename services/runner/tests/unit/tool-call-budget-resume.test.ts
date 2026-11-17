/**
 * An approved call that runs on a resume gets this turn's tool-call watchdog, with the tool's own
 * budget. The harness announced the call in the turn that parked, so the resume never sees a new
 * `tool_call` frame for it. Without the watchdog entry the idle limit (420 s on cloud) could end a
 * long reference call that the user just approved.
 *
 * Run: pnpm exec vitest run tests/unit/tool-call-budget-resume.test.ts
 */
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

vi.stubGlobal("fetch", async () => new Response(JSON.stringify({}), { status: 200 }));

const { acquireEnvironment, runTurn } = await import("../../src/engines/sandbox_agent.ts");
const { fakeHarness } = await import("../utils/sandbox-agent-harness.ts");

function decision(toolCallId: string, toolName: string) {
  return {
    permissionId: `perm-${toolCallId}`,
    reply: "once" as const,
    toolCallId,
    toolName,
    args: {},
    interactionToken: `tok-${toolCallId}`,
    promptPromise: Promise.resolve({ stopReason: "end_turn" }),
  };
}

describe("an approved call that runs on a resume", () => {
  it("starts this turn's watchdog with the tool's own budget, and none for other tools", async () => {
    const { deps } = fakeHarness();
    const starts: Array<[string, number | undefined]> = [];
    deps.createRunLimits = (() => ({
      onTrip() {},
      noteToolCallStart(id: string, budgetMs?: number) {
        starts.push([id, budgetMs]);
      },
      noteToolCallEnd() {},
      noteProgress() {},
      notePaused() {},
      dispose() {},
    })) as any;
    const request: any = {
      sessionId: "sess-budget-resume",
      harness: "claude",
      sandbox: "local",
      telemetry: { exporters: { otlp: { headers: { authorization: "ApiKey test-cred" } } } },
      customTools: [
        { name: "ask_researcher", callRef: "ref-1", timeoutMs: 1_800_000 },
        { name: "mcp__writer", callRef: "ref-2", timeoutMs: 1_800_000 },
      ],
      messages: [{ role: "user", content: "ask the researcher" }],
    };
    const acquired = await acquireEnvironment(request, deps);
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;

    await runTurn(acquired.env, request, undefined, undefined, {
      resume: {
        decisions: [
          decision("call-child", "mcp__agenta-tools__ask_researcher"),
          decision("call-other-server", "mcp__external__ask_researcher"),
          decision("call-write", "Write"),
          // A Pi custom tool whose own name starts with `mcp__`.
          decision("call-pi-named", "mcp__writer"),
        ],
        carriedForward: [],
      },
    });

    assert.deepEqual(starts, [
      ["call-child", 1_800_000],
      // Same bare name on a user's MCP server: not the runner's tool, so no budget.
      ["call-other-server", undefined],
      ["call-write", undefined],
      ["call-pi-named", 1_800_000],
    ]);
  });
});
