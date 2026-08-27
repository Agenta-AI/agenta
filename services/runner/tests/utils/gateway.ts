/**
 * Shared fixtures for the gateway gate tests.
 *
 * One policy serves every file so a case that crosses two of them (an approval identity built
 * in one, a filter drop asserted in another) is talking about the same world. `github` and
 * `slack` deliberately share the `GET_ISSUE` key: that collision is what R17 tests.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSandboxAgent } from "../../src/engines/sandbox_agent.ts";
import { fakeHarness } from "./sandbox-agent-harness.ts";
import type {
  AgentEvent,
  AgentRunRequest,
  GatewayPolicy,
  ResolvedToolSpec,
} from "../../src/protocol.ts";
import type { PermissionPlan } from "../../src/permission-plan.ts";
import {
  ApprovalResponder,
  ConversationDecisions,
} from "../../src/responder.ts";
import { buildGatewayToolGate } from "../../src/engines/sandbox_agent/gateway-gate.ts";
import {
  normalizeGatewayPolicy,
  type GatewayToolGate,
  type NormalizedGatewayPolicy,
} from "../../src/tools/gateway-policy.ts";
import {
  localRelayHost,
  startToolRelay,
  RELAY_REQ_SUFFIX,
  RELAY_RES_SUFFIX,
} from "../../src/tools/relay.ts";
import { sleep } from "../../src/tools/relay-protocol.ts";
import type { RelayResponse } from "../../src/tools/relay-protocol.ts";

export const GATEWAY_POLICY: GatewayPolicy = {
  integrations: {
    github: {
      provider: "composio",
      connection: "github-work",
      toolkitVersion: "20250827_00",
      tools: {
        GET_ISSUE: { permission: "allow", readOnly: true },
        CREATE_ISSUE: { permission: "ask", readOnly: false },
        DELETE_REPOSITORY: { permission: "deny", readOnly: false },
        LIST_ISSUES: { permission: "allow", readOnly: null },
      },
    },
    slack: {
      provider: "composio",
      connection: "slack-main",
      toolkitVersion: "20250827_00",
      tools: {
        SEND_MESSAGE: { permission: "ask", readOnly: false },
        // The same key as a github tool, under a different integration and permission.
        GET_ISSUE: { permission: "ask", readOnly: true },
      },
    },
  },
};

/**
 * The same policy after intake validation — what every decision function actually takes. The raw
 * fixture above is still what rides the wire and what `startToolRelay` is handed, so the two are
 * kept side by side deliberately: a test that passes the raw one to a decision fails to compile.
 */
export const NORMALIZED_POLICY: NormalizedGatewayPolicy =
  normalizeGatewayPolicy(GATEWAY_POLICY);

/** An agent with no gateway connection at all. */
export const EMPTY_POLICY: NormalizedGatewayPolicy =
  normalizeGatewayPolicy(undefined);

export const RUN_TOOL_SPEC: ResolvedToolSpec = {
  name: "run_tool",
  kind: "callback",
  callRef: "gateway.run",
  permission: "allow",
  inputSchema: {
    type: "object",
    properties: {
      integration: { type: "string" },
      tool: { type: "string" },
      arguments: { type: "object" },
    },
    required: ["integration", "tool", "arguments"],
  },
};

export const SEARCH_TOOL_SPEC: ResolvedToolSpec = {
  name: "search_tools",
  kind: "callback",
  callRef: "gateway.search",
  permission: "allow",
  readOnly: true,
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" }, integration: { type: "string" } },
    required: ["query"],
  },
};

export interface RecordedInteraction {
  token: string;
  toolName: string | undefined;
  toolArgs: unknown;
  kind: "user_approval" | "client_tool";
  toolCallId?: string;
}

export interface TestGateHarness {
  gate: GatewayToolGate;
  events: AgentEvent[];
  interactions: RecordedInteraction[];
  pausedToolCallIds: string[];
  pauses: number;
  nonParkable: number;
  logs: string[];
}

/**
 * A gateway gate over the REAL responder ladder, with the turn's emit/pause/interaction sinks
 * captured. Using the real `ApprovalResponder` is the point: the operator switch, the compiled
 * permission and the stored answer must be ordered by the shared code, not by the test.
 */
export function buildTestGatewayGate(opts?: {
  plan?: PermissionPlan;
  storedDecisions?: Map<string, unknown>;
}): TestGateHarness {
  const events: AgentEvent[] = [];
  const interactions: RecordedInteraction[] = [];
  const pausedToolCallIds: string[] = [];
  const logs: string[] = [];
  // One mutable object, returned as-is: a spread would freeze the counters at zero.
  const harness = {
    events,
    interactions,
    pausedToolCallIds,
    pauses: 0,
    nonParkable: 0,
    logs,
  } as TestGateHarness;
  const plan: PermissionPlan = opts?.plan ?? {
    default: "allow_reads",
    rules: [],
  };
  const decisions = new ConversationDecisions(
    opts?.storedDecisions ?? new Map(),
  );
  const gate = buildGatewayToolGate({
    responder: new ApprovalResponder(plan, decisions, () => {}),
    run: { emitEvent: (event) => void events.push(event) },
    pause: {
      markPausedToolCall: (id) => void pausedToolCallIds.push(id),
      pause: () => {
        harness.pauses += 1;
      },
    },
    recordPendingInteraction: (token, toolName, toolArgs, kind, toolCallId) => {
      interactions.push({ token, toolName, toolArgs, kind, toolCallId });
    },
    permissionPlan: plan,
    onNonParkablePause: () => {
      harness.nonParkable += 1;
    },
    log: (message) => void logs.push(message),
  });
  harness.gate = gate;
  return harness;
}

export type InteractionRequestEvent = Extract<
  AgentEvent,
  { type: "interaction_request" }
>;

/** The interaction requests a turn emitted, narrowed out of the event union. */
export function interactionRequests(
  events: AgentEvent[],
): InteractionRequestEvent[] {
  return events.filter(
    (event): event is InteractionRequestEvent =>
      event.type === "interaction_request",
  );
}

/** The callback endpoint every helper below points the relay at. */
export const TOOL_CALLBACK = {
  endpoint: "https://api.example/tools/call",
  authorization: "Access tok-test",
};

const createdDirs: string[] = [];

export function makeRelayDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gateway-relay-"));
  createdDirs.push(dir);
  return dir;
}

/** Call from `afterEach`: removes every directory `makeRelayDir` handed out. */
export function cleanupRelayDirs(): void {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface StubbedCalls {
  bodies: Record<string, any>[];
  urls: string[];
}

/** Answer every `/tools/call` POST with one successful result, recording what was sent. */
export function stubToolCall(content: unknown): StubbedCalls {
  return stubToolResponse(() => ({
    call: {
      data: {
        content:
          typeof content === "string" ? content : JSON.stringify(content),
      },
      status: { code: "STATUS_CODE_OK" },
    },
  }));
}

/**
 * Answer every `/tools/call` POST with a business-level failure: the agent-error envelope as
 * the content, over HTTP 200, exactly as the gateway routes return one.
 */
export function stubToolError(
  envelope: unknown,
  message: string,
): StubbedCalls {
  return stubToolResponse(() => ({
    call: {
      data: { content: JSON.stringify(envelope) },
      status: { code: "STATUS_CODE_ERROR", message },
    },
  }));
}

function stubToolResponse(body: () => unknown): StubbedCalls {
  const calls: StubbedCalls = { bodies: [], urls: [] };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.urls.push(String(url));
    calls.bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(body()), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

export async function until(
  condition: () => boolean,
  what: string,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/**
 * Write a relay request file directly — the forged in-sandbox path. The runner cannot tell this
 * from a request the harness's own shim wrote, which is the property under test.
 */
export async function forgeRelayRequest(
  dir: string,
  id: string,
  args: unknown,
  toolName: string = RUN_TOOL_SPEC.name,
): Promise<void> {
  await localRelayHost().write(
    `${dir}/${id}${RELAY_REQ_SUFFIX}`,
    JSON.stringify({ toolName, toolCallId: id, args }),
  );
}

export async function readRelayResponse(
  dir: string,
  id: string,
): Promise<RelayResponse> {
  const path = join(dir, `${id}${RELAY_RES_SUFFIX}`);
  await until(() => existsSync(path), `the relay response for ${id}`);
  return JSON.parse(readFileSync(path, "utf-8")) as RelayResponse;
}

export interface RunningGatewayRelay {
  dir: string;
  stop: () => Promise<void>;
  harness: TestGateHarness;
  /** Every line the relay loop logged, including the `[gateway]` measurement lines. */
  relayLogs: string[];
}

/** The real relay loop over a real directory, with the gateway policy and gate wired in. */
export async function startGatewayRelay(opts?: {
  harness?: TestGateHarness;
  storedDecisions?: Map<string, unknown>;
  specs?: ResolvedToolSpec[];
  policy?: GatewayPolicy;
  /** Omit the gate to prove a run without one fails closed. */
  withoutGate?: boolean;
}): Promise<RunningGatewayRelay> {
  const dir = makeRelayDir();
  const harness =
    opts?.harness ??
    buildTestGatewayGate({ storedDecisions: opts?.storedDecisions });
  const relayLogs: string[] = [];
  const relay = startToolRelay(
    localRelayHost(),
    dir,
    opts?.specs ?? [RUN_TOOL_SPEC, SEARCH_TOOL_SPEC],
    TOOL_CALLBACK,
    undefined,
    undefined,
    undefined,
    {
      gatewayPolicy: opts?.policy ?? GATEWAY_POLICY,
      ...(opts?.withoutGate ? {} : { gatewayGate: harness.gate }),
      writePausedAnswer: true,
      log: (message) => void relayLogs.push(message),
    },
  );
  await relay.ready;
  return { dir, stop: relay.stop, harness, relayLogs };
}

/** The `[gateway]` measurement lines only, with the relay's own pickup telemetry filtered out. */
export function gatewayLogs(relayLogs: string[]): string[] {
  return relayLogs.filter((line) => line.startsWith("[gateway]"));
}

export interface ProductionWiredRelay {
  dir: string;
  stop: () => Promise<void>;
  events: AgentEvent[];
  relayOpts: Record<string, any>;
  calls: ReturnType<typeof fakeHarness>["calls"];
}

/**
 * Run the REAL engine for one request, then start the REAL relay on the wiring the engine
 * produced. The policy, the gate, the responder, the permission plan and the execution guard all
 * come from `runTurn`; the test supplies only transport (a real directory and a real local host),
 * because the sandbox harness stubs those as strings.
 *
 * `responderFactory` is deleted so the run builds its own `ApprovalResponder` from its own
 * permission plan and the conversation's stored decisions. The harness's fake responder answers
 * `allow` to everything and would hide every gate this exists to exercise.
 */
export async function startRelayFromProductionWiring(
  request: AgentRunRequest,
): Promise<ProductionWiredRelay> {
  const harness = fakeHarness();
  delete (harness.deps as { responderFactory?: unknown }).responderFactory;

  const result = await runSandboxAgent(
    request,
    undefined,
    undefined,
    harness.deps,
  );
  assert.equal(
    result.ok,
    true,
    `the run itself must succeed: ${JSON.stringify(result)}\n${harness.logs
      .slice(-8)
      .join("\n")}`,
  );

  const args = harness.calls.toolRelayArgs;
  assert.ok(args, "the engine must start a tool relay for a gateway run");
  const relayOpts = (args[7] ?? {}) as Record<string, any>;
  assert.ok(
    relayOpts.gatewayGate,
    "runTurn must wire a gateway gate on this placement",
  );

  const dir = makeRelayDir();
  const relay = startToolRelay(
    localRelayHost(),
    dir,
    args[2] as never,
    args[3] as never,
    args[4] as never,
    args[5] as never,
    args[6] as never,
    relayOpts as never,
  );
  await relay.ready;
  return {
    dir,
    stop: relay.stop,
    events: harness.events,
    relayOpts,
    calls: harness.calls,
  };
}

/** The approval cards a turn emitted. */
export function approvalCards(events: AgentEvent[]): InteractionRequestEvent[] {
  return interactionRequests(events).filter(
    (event) => event.kind === "user_approval",
  );
}

/** What the frontend persists for one approval, and folds back into the next turn's history. */
export interface PersistedApprovalPart {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * Project an emitted `interaction_request` the way the Vercel egress does.
 *
 * This MIRRORS `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py` — `_interaction_parts`
 * for `user_approval`, `_approval_tool_name`, `_tool_call_input`, and `_unwrap_tool_arguments` —
 * because that projection is what decides the persisted `tool_call` part, and that part is what
 * the NEXT turn folds back into the stored approval key. The runner cannot see the Python side,
 * so the round-trip test pins the rule here and runs everything downstream of it for real.
 *
 * Keep the precedence identical to that file. The Python side pins the same rule against the real
 * projection, in
 * `sdks/python/oss/tests/pytest/unit/agents/adapters/test_vercel_stream_gateway_approval.py`; if
 * `stream.py` changes, that test fails first and this mirror must be updated to match.
 */
export function projectApprovalAsVercelEgressWould(
  event: InteractionRequestEvent,
): PersistedApprovalPart {
  const payload = (event.payload ?? {}) as Record<string, any>;
  const toolCall = (payload.toolCall ?? {}) as Record<string, any>;
  const toolCallId = String(
    payload.toolCallId ?? toolCall.toolCallId ?? toolCall.id,
  );

  // `_approval_tool_name`: resolvedName -> a nested spec's name -> name -> title -> kind.
  const spec = ["spec", "toolSpec", "resolvedTool", "tool"]
    .map((alias) => toolCall[alias])
    .find((value) => value !== null && typeof value === "object") as
    Record<string, any> | undefined;
  const toolName =
    toolCall.resolvedName ??
    spec?.name ??
    toolCall.name ??
    toolCall.title ??
    toolCall.kind;

  // `_tool_call_input`: rawInput when not None, else input; then the envelope unwrap.
  const raw =
    toolCall.rawInput !== undefined ? toolCall.rawInput : toolCall.input;
  return { toolCallId, toolName: String(toolName), input: unwrapEnvelope(raw) };
}

/** `_TOOL_ARGUMENT_ENVELOPE_KEYS` in `stream.py`. Note that `tool` is one of them. */
const TOOL_ARGUMENT_ENVELOPE_KEYS = new Set([
  "tool",
  "server",
  "name",
  "toolName",
  "serverName",
  "tool_name",
  "server_name",
]);

/**
 * `_unwrap_tool_arguments`: collapse a `{tool, server, arguments}` MCP envelope to the bare
 * arguments, but ONLY when every sibling of `arguments` is a string-valued envelope key.
 *
 * `run_tool`'s outer arguments are `{integration, tool, arguments}`, and `integration` is not an
 * envelope key — which is the only reason they survive this. Worth knowing: a future argument
 * shape of just `{tool, arguments}` would be silently unwrapped here and the approval identity
 * would collapse to the inner arguments again.
 */
function unwrapEnvelope(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  const args = record.arguments;
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return value;
  }
  const siblings = Object.keys(record).filter((key) => key !== "arguments");
  if (siblings.length === 0) return value;
  const allEnvelope = siblings.every(
    (key) =>
      TOOL_ARGUMENT_ENVELOPE_KEYS.has(key) && typeof record[key] === "string",
  );
  return allEnvelope ? args : value;
}
