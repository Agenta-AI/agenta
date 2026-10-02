import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import { buildPiGateEnvelope } from "../../src/engines/sandbox_agent/pi-gate-envelope.ts";
import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";

afterEach(() => vi.unstubAllEnvs());

it("a pause-time completion cannot exceed the budget and then report a successful park", async () => {
  vi.stubEnv("AGENTA_RUNNER_OUTPUT_MAX_BYTES", "8192");
  const { deps } = fakeHarness({
    promptEvents: ["tool-ask", "tool-other"].map((id) => ({
      payload: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: id,
          title: "approval_needed",
        },
      },
    })),
    emitPermission: true,
    permissionDecision: "pendingApproval",
    permissionRequests: [
      {
        id: "perm-pi",
        availableReplies: ["once", "reject"],
        toolCall: {
          toolCallId: "pi-ui-synthetic",
          title: "agenta-approval",
          rawInput: {
            method: "confirm",
            title: "agenta-approval",
            message: buildPiGateEnvelope({
              gate: "pi-custom-tool",
              toolName: "approval_needed",
              toolCallId: "tool-ask",
              input: {},
            }),
          },
        },
      },
    ],
    postPermissionEvents: [
      {
        payload: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-other",
            status: "completed",
            rawOutput: "x".repeat(16_384),
          },
        },
      },
    ],
  });
  deps.createOtel = (init) =>
    createSandboxAgentOtel({ ...init, emitSpans: false });
  const events: AgentEvent[] = [];
  const result = await runSandboxAgent(
    {
      harness: "pi_core",
      permissions: { default: "ask" },
      messages: [{ role: "user", content: "use the tool" }],
      customTools: [
        { name: "approval_needed", kind: "callback", permission: "ask" },
      ],
    } as AgentRunRequest,
    (event) => events.push(event),
    undefined,
    deps,
  );
  assert.ok(
    events.some((event) => event.type === "interaction_request"),
    "the approval was reached",
  );
  assert.equal(result.ok, false);
  assert.match(result.error!, /output exceeded/);
  assert.equal(
    events.filter(
      (event) =>
        event.type === "error" && event.code === "output_limit_exceeded",
    ).length,
    1,
  );
  assert.equal(events.filter((event) => event.type === "done").length, 1);
  assert.equal(events.at(-1)?.type, "done");
});
