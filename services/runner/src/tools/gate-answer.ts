/**
 * The server's answer at the approval gate (`tools.agenta.resolve_gate`).
 *
 * The runner decides one permission per tool from the run's configuration. It cannot know which
 * agent a session id names, or whether a person sent the turn. So when the gate of a session
 * write is about to ask a person, the runner asks the API first. The API answers with the
 * runner's own permission words: `allow` runs the call with no card, `deny` refuses it with no
 * card, and `ask` shows the card.
 *
 * The answer can only remove a card that the run's configuration would show, or refuse a call.
 * It never shows a card that the configuration skips, because the runner asks only after the
 * configuration said `ask`. So every failure (no callback, a refusal, a timeout, an unknown op on
 * an older API, a malformed answer) reads as `ask`, and the card shows as it does without this.
 */
import type {
  ResolvedToolSpec,
  RunContext,
  ToolPermission,
} from "../protocol.ts";
import { callAgentaTool } from "./callback.ts";
import { applyContextBindings, stripEphemeralArgs } from "./direct.ts";
import type { ToolCallbackRuntime } from "./run-credential.ts";

const RESOLVE_GATE_CALL_REF = "tools.agenta.resolve_gate";

/**
 * The calls the runner asks about, by the call ref their spec carries. Only the three session
 * writes for now; other `tools.agenta.` ops keep the card that their configuration gives them.
 */
const GATE_ANSWER_CALL_REFS = new Set([
  "tools.agenta.start_session",
  "tools.agenta.send_session_message",
  "tools.agenta.cancel_session",
]);

/** The card waits at most this long for the answer, then shows. */
export const GATE_ANSWER_TIMEOUT_MS = 5_000;

const PERMISSIONS: readonly ToolPermission[] = ["allow", "ask", "deny"];

export interface GateAnswer {
  permission: ToolPermission;
  /** Why the server answered `allow` or `deny`. Absent on `ask`. */
  basis?: string;
}

/**
 * Returns no promise for a call the runner does not ask about, so its gate does not wait a tick.
 * A returned promise never rejects: a failure resolves to `{permission: "ask"}`.
 */
export type GateAnswerFetcher = (input: {
  toolName: string | undefined;
  /** The harness's tool call id, or the gate's own request id when the gate has none. */
  callId: string;
  args: unknown;
}) => Promise<GateAnswer> | undefined;

export function buildGateAnswerFetcher(input: {
  callback: ToolCallbackRuntime | undefined;
  runContext: RunContext | undefined;
  toolSpecs: ResolvedToolSpec[];
  /** The runner's own execution (`request.turnId`). The server checks that it is the current one. */
  executionId: string;
  signal?: AbortSignal;
  log?: (message: string) => void;
  /** Tests only; the runner uses `GATE_ANSWER_TIMEOUT_MS`. */
  timeoutMs?: number;
}): GateAnswerFetcher {
  const specsByName = new Map(
    input.toolSpecs.map((spec) => [spec.name, spec] as const),
  );
  return ({ toolName, callId, args }) => {
    const spec = toolName ? specsByName.get(toolName) : undefined;
    if (!spec?.callRef || !GATE_ANSWER_CALL_REFS.has(spec.callRef))
      return undefined;
    return fetchAnswer(spec, callId, args);
  };

  async function fetchAnswer(
    spec: ResolvedToolSpec,
    callId: string,
    args: unknown,
  ): Promise<GateAnswer> {
    const started = Date.now();
    let answer: GateAnswer;
    try {
      const endpoint = input.callback?.endpoint;
      if (!endpoint) throw new Error("no Agenta callback endpoint");
      // The arguments the call itself would send: the note for the person removed, and the
      // caller bindings filled from run context, so the API reads the same target.
      const callArgs = applyContextBindings(
        stripEphemeralArgs(args, spec.ephemeralArgs),
        spec.contextBindings ?? {},
        input.runContext,
      );
      // `callAgentaTool` adds a grace window to its own budget, so the limit rides the signal.
      const limit = AbortSignal.timeout(
        input.timeoutMs ?? GATE_ANSWER_TIMEOUT_MS,
      );
      const raw = await callAgentaTool(
        endpoint,
        input.callback?.credential(),
        RESOLVE_GATE_CALL_REF,
        `resolve-gate-${callId}`,
        {
          call_ref: spec.callRef,
          arguments: callArgs,
          execution_id: input.executionId,
          configured_permission: spec.configuredPermission ?? null,
          target_permissions: spec.targetPermissions ?? {},
        },
        {
          signal: input.signal ? AbortSignal.any([input.signal, limit]) : limit,
        },
      );
      answer = parseAnswer(raw);
    } catch (error) {
      input.log?.(
        `[HITL] resolve_gate failed toolName=${JSON.stringify(spec.name)}; the card shows: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      answer = { permission: "ask" };
    }
    input.log?.(
      `[HITL] resolve_gate toolName=${JSON.stringify(spec.name)} permission=${answer.permission} ` +
        `basis=${answer.basis ?? "none"} ms=${Date.now() - started}`,
    );
    return answer;
  }
}

/** `{permission, basis}`. Anything else is a fault, and a fault throws so the card shows. */
function parseAnswer(raw: string): GateAnswer {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("the gate answer is not an object");
  }
  const { permission, basis } = parsed as Record<string, unknown>;
  if (!PERMISSIONS.includes(permission as ToolPermission)) {
    throw new Error(
      `the gate answer has no known permission: ${JSON.stringify(permission)}`,
    );
  }
  if (permission === "ask") return { permission: "ask" };
  if (typeof basis !== "string" || !basis) {
    throw new Error(`the gate answer '${permission}' has no basis`);
  }
  return { permission: permission as ToolPermission, basis };
}
