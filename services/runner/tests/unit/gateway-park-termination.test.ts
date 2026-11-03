/**
 * A turn parked on a gateway approval must END, and end promptly.
 *
 * THE DEFECT THIS PINS. A gateway run passes TWO gates on ONE tool-call id. The ACP gate on the
 * outer `run_tool` answers `allow` (its spec permission is `allow`), which marks the id an
 * allowed execution. The relay then hands the call to the gateway gate, which reads the policy
 * for the TARGET action, answers `ask`, and parks the same id. Nothing un-marks the first.
 *
 * Paused-turn terminalization used to wait for every open allowed execution to close, so it
 * waited on a call that cannot close until a human answers, and burned the whole tool-call bound
 * before the turn could end. `run()` never returned in that window, the alive watchdog was never
 * released, and the session kept reporting `running=true` — so a resume arriving in the meantime
 * was killed as `supersede-busy`. Measured live on 2026-08-27: the parked turn returned 30
 * minutes and 2ms after the gate parked it, the bound being `DEFAULT_TOOL_CALL_TIMEOUT_MS`.
 *
 * Before the gateway existed, "allowed execution" and "paused call" were disjoint by
 * construction, which is why the wait was safe to write.
 *
 * WHY THIS FILE CARRIES ITS OWN TRANSCRIPT. `fakeHarness`'s run stub answers `openToolCallIds()`
 * with `[]` unconditionally, so the terminalization wait is unreachable through it and every
 * assertion here would pass vacuously. The local `trackingRun` below tracks open calls and
 * honours `settleOpenToolCalls` the way the real transcript does, which is the whole mechanism
 * under test. Everything else — the policy, both gates, the responder, the relay — is production
 * wiring, driven through `runSandboxAgent`.
 *
 * Run: pnpm exec vitest run tests/unit/gateway-park-termination.test.ts
 */
import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";

import type { AgentEvent, AgentRunRequest } from "../../src/protocol.ts";
import { resetRunnerConfigCache } from "../../src/config/runner-config.ts";
import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import { localRelayHost, startToolRelay } from "../../src/tools/relay.ts";
import { fakeHarness } from "../utils/sandbox-agent-harness.ts";
import {
  GATEWAY_POLICY,
  RUN_TOOL_SPEC,
  SEARCH_TOOL_SPEC,
  TOOL_CALLBACK,
  cleanupRelayDirs,
  forgeRelayRequest,
  makeRelayDir,
  stubToolCall,
} from "../utils/gateway.ts";

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS = "local,daytona";
  process.env.AGENTA_RUNNER_DAYTONA_API_KEY = "test-key";
  resetRunnerConfigCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  cleanupRelayDirs();
});

/** `CREATE_ISSUE` is the ask-tier action in `GATEWAY_POLICY`. */
const ASK_CALL = {
  integration: "github",
  tool: "CREATE_ISSUE",
  arguments: { title: "bug" },
};

interface Settlement {
  id: string;
  message: string;
}

/**
 * A transcript that actually tracks open tool calls, which is what the wait under test consults.
 * `open` seeds the ids the harness announced; `settleOpenToolCalls` closes every open id the
 * predicate does not exclude, recording what it was closed with.
 */
function trackingRun(open: string[]) {
  const openIds = new Set(open);
  const events: AgentEvent[] = [];
  const settlements: Settlement[] = [];
  return {
    openIds,
    events,
    settlements,
    run: {
      start() {},
      handleUpdate() {},
      emitEvent(event: AgentEvent) {
        events.push(event);
      },
      usage() {
        return { input: 0, output: 0, total: 0, cost: 0 };
      },
      setUsage() {},
      finish() {
        return "assistant output";
      },
      recordError() {},
      markToolCallDenied() {},
      output() {
        return "assistant output";
      },
      async flush() {},
      events() {
        return events;
      },
      settleOpenToolCalls(
        isExcluded: (id: string) => boolean,
        message: string,
      ) {
        for (const id of [...openIds]) {
          if (isExcluded(id)) continue;
          openIds.delete(id);
          settlements.push({ id, message });
        }
      },
      openToolCallIds() {
        return [...openIds];
      },
      traceId() {
        return "trace-1";
      },
    },
  };
}

interface LiveRelayRun {
  result: Awaited<ReturnType<typeof runSandboxAgent>>;
  settlements: Settlement[];
  events: AgentEvent[];
  logs: string[];
}

/**
 * Run the REAL engine with the REAL relay live FOR THE DURATION OF THE TURN.
 *
 * `startRelayFromProductionWiring` cannot express this case: it runs the engine to completion and
 * only then starts a relay, so a pause raised through the relay never lands while the turn is
 * still terminalizing. Here the engine's own `startToolRelay` dependency starts the real loop on
 * a real directory, and `afterPromptGates` forges the gateway call into it — the window in which
 * the ACP gate has already answered and the harness would be dispatching to the relay.
 */
async function runWithLiveRelay(opts: {
  call: unknown;
  toolCallId: string;
  /** Ids the transcript reports as open when the turn starts terminalizing. */
  open: string[];
}): Promise<LiveRelayRun> {
  const tracked = trackingRun(opts.open);
  let relayDir = "";
  const harness = fakeHarness({
    emitPermission: true,
    permissionRequests: [
      {
        id: "perm-gw",
        availableReplies: ["once", "always", "reject"],
        toolCall: {
          toolCallId: opts.toolCallId,
          name: RUN_TOOL_SPEC.name,
          title: RUN_TOOL_SPEC.name,
          rawInput: opts.call,
          input: opts.call,
        },
      },
    ],
    afterPromptGates: async () => {
      await forgeRelayRequest(relayDir, opts.toolCallId, opts.call);
      // Give the relay loop its poll window to pick the request up and reach the gate.
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    // Claude does not end a turn on an unanswered gate. The park signal is what must end it.
    hangPrompt: true,
  });
  // The real responder, so the real permission plan decides. The fake one allows everything and
  // would answer the gateway gate too.
  delete (harness.deps as { responderFactory?: unknown }).responderFactory;
  harness.deps.createOtel = (() => tracked.run) as never;
  harness.deps.startToolRelay = ((...args: unknown[]) => {
    relayDir = makeRelayDir();
    return startToolRelay(
      localRelayHost(),
      relayDir,
      args[2] as never,
      args[3] as never,
      args[4] as never,
      args[5] as never,
      args[6] as never,
      (args[7] ?? {}) as never,
    );
  }) as never;

  const request = {
    harness: "claude",
    sandbox: "local",
    messages: [{ role: "user", content: "file the issue" }],
    customTools: [RUN_TOOL_SPEC, SEARCH_TOOL_SPEC],
    toolCallback: TOOL_CALLBACK,
    gatewayPolicy: GATEWAY_POLICY,
    permissions: { default: "allow_reads" },
  } as AgentRunRequest;

  const result = await runSandboxAgent(
    request,
    undefined,
    undefined,
    harness.deps,
  );
  return {
    result,
    settlements: tracked.settlements,
    events: tracked.events,
    logs: harness.logs,
  };
}

describe("a turn parked on a gateway approval", () => {
  it("ends instead of waiting out the tool-call bound", async () => {
    stubToolCall({ created: true });

    // PRE-FIX THIS NEVER RESOLVES. `tc-gw` is an allowed execution (the ACP gate said allow) and
    // still open, so terminalization waits for a closure only a human can produce, for the full
    // 30-minute bound. Vitest fails the test on its own timeout. That is the red.
    const { result, logs } = await runWithLiveRelay({
      call: ASK_CALL,
      toolCallId: "tc-gw",
      open: ["tc-gw"],
    });

    assert.ok(
      logs.some((line) => line.includes("outcome=pendingApproval")),
      "the gateway gate must actually have parked the call, or this test proves nothing",
    );
    assert.equal(result.ok, true, "a park is a successful turn, not a failure");
    assert.equal(
      result.stopReason,
      "paused",
      "the turn must still end as paused — the fix must not turn a park into a completion",
    );
  });

  it("leaves the parked call open and unexecuted, and settles nothing on its behalf", async () => {
    // The parked call must survive terminalization OPEN: its `interaction_request` is the last
    // word for the call this turn, and the resume answers that exact id. Terminalization settles
    // orphaned siblings, and deliberately excludes both paused calls and allowed executions.
    // So the fix must remove the parked id from the WAIT set without settling it — a settled
    // parked call would be a different bug, one that loses the human's pending answer.
    const calls = stubToolCall({ created: true });

    const { settlements, result } = await runWithLiveRelay({
      call: ASK_CALL,
      toolCallId: "tc-park",
      open: ["tc-park"],
    });

    assert.equal(calls.bodies.length, 0, "a parked call never executes");
    assert.deepEqual(
      settlements,
      [],
      "nothing was force-settled: the parked call is left open for the resume to answer",
    );
    assert.equal(result.stopReason, "paused");
  });

  // THE GUARD THAT THE WAIT WAS NARROWED AND NOT DELETED lives in
  // `session-keepalive-approval.test.ts`, and is not duplicated here:
  //
  //   "holds the carried sibling's re-park open until the approved execution reports its result"
  //     — an allowed execution that is NOT parked still gets its closure window, and a result
  //       arriving inside that window is kept rather than overwritten.
  //   "...settles the approved execution with APPROVED_EXECUTION_RESULT_UNKNOWN..."
  //     — the same window expiring on its bound, which is the branch this fix must leave intact.
  //
  // Both drive `pausableHarness`, whose transcript tracks open calls for real and whose
  // `toolCallMs` is shortened, so they fail if the wait ever stops happening. This file cannot
  // host that case: the wait needs a call the ACP gate ALLOWED, and a second allow here would
  // have to be closed through the harness event stream to notify the closure waiters.
});
