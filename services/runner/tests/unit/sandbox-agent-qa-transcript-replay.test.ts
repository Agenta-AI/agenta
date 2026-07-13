/**
 * Replay real captured QA runs through the actual `runSandboxAgent` orchestration -- no live
 * Pi/Claude/sandbox-agent daemon.
 *
 * The agent-workflows QA program (`docs/design/agent-workflows/projects/qa/`) captured 21 real
 * `/invoke` request/response pairs against a live deployment (see `qa/matrix.md`). Until this
 * file, nothing replayed them: every orchestration test drove `runSandboxAgent` with
 * `fakeHarness()` in `sandbox-agent-orchestration.test.ts` -- the author's hand-built mental model
 * of what an ACP session does, not a real recorded run. F-001 (the `append_system` override
 * silently dropped on sandbox-agent) is exactly the kind of regression that model could miss if
 * the fake and the code drifted together.
 *
 * Each test here loads one `qa/runs/*.json` file (via `agentRunRequestFromTranscript`, which
 * never hand-copies a transcript's captured content -- see `tests/utils/qa-transcripts.ts` for
 * the field-name translation the older captures need), drives it through the real
 * `runSandboxAgent` with a minimal fake ACP session (the same DI seam `fakeHarness()` uses:
 * `SandboxAgentDeps`), and asserts the plan/session actually received what the recorded request
 * carried.
 *
 * Run: pnpm test (or: pnpm exec vitest run tests/unit/sandbox-agent-qa-transcript-replay.test.ts)
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  runSandboxAgent,
  type SandboxAgentDeps,
} from "../../src/engines/sandbox_agent.ts";
import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";
import { SessionContinuityStore } from "../../src/engines/sandbox_agent/session-continuity.ts";
import type { AgentRunRequest } from "../../src/protocol.ts";
import {
  agentRunRequestFromTranscript,
  loadTranscript,
} from "../utils/qa-transcripts.ts";

/**
 * A minimal ACP fake tuned for replay assertions: it records the plan `buildRunPlan` derived
 * (so a test can assert `appendSystemPrompt` / `tools` actually reached it) and the exact prompt
 * text the session received, then returns a plain successful result. Deliberately smaller than
 * `sandbox-agent-orchestration.test.ts`'s `fakeHarness()` -- no permission/pause machinery --
 * because a replay test only needs to prove the recorded request reaches the ACP boundary
 * unchanged, not exercise every orchestration branch (that is the existing suite's job).
 */
function fakeReplayHarness() {
  const continuityStore = new SessionContinuityStore();
  const calls = {
    createSessionOptions: undefined as any,
    promptBlocks: undefined as any,
    workspacePlan: undefined as any,
    resumeSessionIds: [] as string[],
    logs: [] as string[],
  };

  const session = {
    id: "session-replay",
    agentSessionId: "native-new",
    onEvent() {},
    onPermissionRequest() {},
    async prompt(blocks: any) {
      calls.promptBlocks = blocks;
      return { stopReason: "complete", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };

  const sandbox = {
    async resumeSession(id: string) {
      calls.resumeSessionIds.push(id);
      return { ...session, agentSessionId: "native-stale" };
    },
    async createSession(opts: any) {
      calls.createSessionOptions = opts;
      return session;
    },
    async destroySession() {},
    async destroySandbox() {},
    async dispose() {},
  };

  const run = {
    start() {},
    handleUpdate() {},
    emitEvent() {},
    usage() {
      return { input: 0, output: 0, total: 0, cost: 0 };
    },
    setUsage() {},
    finish() {
      return "assistant output";
    },
    recordError() {},
    output() {
      return "assistant output";
    },
    async flush() {},
    events() {
      return [];
    },
    settleOpenToolCalls() {},
    traceId() {
      return "trace-replay";
    },
  };

  const deps: SandboxAgentDeps = {
    log: (message) => {
      calls.logs.push(message);
    },
    sessionContinuityStore: continuityStore,
    hydrateHarnessSessionFromDurable: async () => {},
    syncHarnessSessionDurable: async () => {},
    createLocalCwd: () => "/tmp/agenta-replay-cwd",
    createDaytonaCwd: () => "/home/sandbox/agenta-replay-cwd",
    resolveSkillDirs: () => ({ skills: [], cleanup: () => {} }),
    buildDaemonEnv: () => ({}),
    resolveDaemonBinary: () => "/bin/sandbox-agent",
    buildSandboxProvider: () => ({ provider: true }) as any,
    createPersist: () => ({ updateSession: async () => {} }) as any,
    startSandboxAgent: (async () => sandbox) as any,
    prepareWorkspace: (async ({ plan }: any) => {
      calls.workspacePlan = plan;
      return { cleanup: async () => {} };
    }) as any,
    probeCapabilities: async () =>
      ({
        source: "probed",
        capabilities: {
          mcpTools: true,
          toolCalls: true,
          usage: true,
          streamingDeltas: true,
        },
      }) as any,
    applyModel: async (_session, model) => model ?? "resolved-model",
    createOtel: (() => run) as any,
    startToolRelay: (() => ({ stop: async () => {} })) as any,
    localRelayHost: (() => "local-relay-host") as any,
    sandboxRelayHost: (() => "sandbox-relay-host") as any,
    responderFactory: () => ({
      async onPermission() {
        return { kind: "allow" } as const;
      },
      async onClientTool() {
        return { kind: "deny" } as const;
      },
    }),
  };

  return { calls, deps, continuityStore };
}

describe("runSandboxAgent replays real captured QA transcripts", () => {
  it("replays the append_system regression capture: the override reaches the plan (F-001 guard)", async () => {
    const transcript = loadTranscript("E2__append_system_pi.json");
    const request = agentRunRequestFromTranscript(transcript);

    // Guard the fixture itself, not just the parsed shape: the captured cell recorded a real
    // append_system override and a FAILING reply (the QA program's own F-001 evidence). If
    // either drifts, this test would silently stop meaning what its name says.
    assert.equal(transcript.passed, false);
    assert.match(transcript.expect, /F-001/);
    assert.ok(request.appendSystemPrompt, "captured request must carry an append_system override");

    const { calls, deps } = fakeReplayHarness();
    deps.createOtel = createSandboxAgentOtel as any;

    const result = await runSandboxAgent(request, undefined, undefined, deps);

    assert.equal(result.ok, true);
    // The plan is where F-001 actually broke (`pi-assets.ts` never received the override): assert
    // directly on it, not on a downstream side effect that a fake session cannot reproduce.
    assert.equal(
      calls.workspacePlan.appendSystemPrompt,
      request.appendSystemPrompt,
      "buildRunPlan must carry the recorded append_system override through to the plan",
    );
    assert.equal(calls.workspacePlan.hasSystemPrompt, true);
    // The session receives the plan's turnText (the orchestration's framing of the request),
    // not necessarily just the last message -- assert against it so multi-message captures hold.
    assert.deepEqual(calls.promptBlocks, [
      { type: "text", text: calls.workspacePlan.turnText },
    ]);
  });

  it.each(["E2__smoke_chat_pi.json", "E2__builtin_bash_pi.json"])(
    "replays a green capture end to end: %s",
    async (name) => {
      const transcript = loadTranscript(name);
      const request = agentRunRequestFromTranscript(transcript);
      assert.equal(transcript.passed, true);

      const { calls, deps } = fakeReplayHarness();
      deps.createOtel = createSandboxAgentOtel as any;

      const result = await runSandboxAgent(request, undefined, undefined, deps);

      assert.equal(result.ok, true);
      // `createSessionOptions.agent` is the ACP agent id ("pi"/"claude"), distinct from the
      // wire's `harness` selector ("pi_core"/"pi_agenta"/"claude") -- both `pi_core` and
      // `pi_agenta` drive the same "pi" ACP agent (see `run-plan.ts`'s `acpAgent` derivation).
      assert.equal(calls.createSessionOptions.agent, "pi");
      assert.deepEqual(calls.promptBlocks, [
        { type: "text", text: calls.workspacePlan.turnText },
      ]);
      // The declared builtin tool (e.g. "bash") must reach the plan's forced-tool grant set --
      // asserted generically so this holds whether or not a given green cell declares tools.
      for (const tool of request.tools ?? []) {
        assert.ok(
          calls.workspacePlan.builtinGrants.includes(tool),
          `expected builtin tool '${tool}' to reach the plan's builtinGrants`,
        );
      }
    },
  );
});

describe("cold Pi native-history fallback", () => {
  it("bypasses an eligible stale native pointer and sends canonical replay to a clean session", async () => {
    const { calls, deps, continuityStore } = fakeReplayHarness();
    continuityStore.record("session-loss", "pi_core", "native-stale", 0);
    const request: AgentRunRequest = {
      harness: "pi_core",
      sandbox: "local",
      sessionId: "session-loss",
      messages: [
        { role: "user", content: "Remember marker ALPHA-7" },
        { role: "assistant", content: "I will remember ALPHA-7" },
        { role: "user", content: "What marker did I give you?" },
      ],
    };

    const result = await runSandboxAgent(request, undefined, undefined, deps);

    assert.equal(result.ok, true);
    assert.deepEqual(
      calls.resumeSessionIds,
      [],
      "cold Pi must not call an identity-free native load",
    );
    assert.equal(calls.createSessionOptions.agent, "pi");
    assert.match(calls.promptBlocks[0].text, /Conversation so far:/);
    assert.match(calls.promptBlocks[0].text, /Remember marker ALPHA-7/);
    assert.match(calls.promptBlocks[0].text, /What marker did I give you\?/);
    assert.ok(
      calls.logs.some((line) =>
        line.includes("outcome=unverified replay=canonical"),
      ),
      "the continuity decision must be observable without transcript content",
    );
    assert.deepEqual(continuityStore.get("session-loss", "pi_core"), {
      agentSessionId: "native-new",
      turnIndex: 1,
    });
  });

  it("keeps non-Pi native resume behavior unchanged", async () => {
    const { calls, deps, continuityStore } = fakeReplayHarness();
    continuityStore.record("session-claude", "claude", "native-stale", 0);
    const request: AgentRunRequest = {
      harness: "claude",
      sandbox: "local",
      sessionId: "session-claude",
      messages: [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "latest" },
      ],
    };

    const result = await runSandboxAgent(request, undefined, undefined, deps);

    assert.equal(result.ok, true);
    assert.deepEqual(calls.resumeSessionIds, ["session-claude:claude"]);
    assert.equal(calls.createSessionOptions, undefined);
    assert.deepEqual(calls.promptBlocks, [{ type: "text", text: "latest" }]);
  });
});
