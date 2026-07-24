import type { AgentEvent } from "../../protocol.ts";
import type { GateDescriptor } from "../../permission-plan.ts";
import type { Responder } from "../../responder.ts";
import type {
  ExecutableToolGate,
  ExecutableToolGateRequest,
} from "../../tools/executable-tool-gate.ts";
import type { ToolCallCorrelationIndex } from "./client-tools.ts";

type EmitRun = { emitEvent: (event: AgentEvent) => void };

interface PauseLike {
  markPausedToolCall(toolCallId: string): void;
  pause(): void;
}

export interface BuildExecutableToolGateInput {
  responder: Responder;
  run: EmitRun;
  pause: PauseLike;
  recordPendingInteraction: (
    token: string,
    toolName: string | undefined,
    toolArgs: unknown,
    kind: "user_approval" | "client_tool",
  ) => void;
  toolCallIndex?: ToolCallCorrelationIndex;
  log?: (message: string) => void;
}

export function buildExecutableToolGate({
  responder,
  run,
  pause,
  recordPendingInteraction,
  toolCallIndex,
  log = () => {},
}: BuildExecutableToolGateInput): ExecutableToolGate {
  return {
    onExecutableTool: async (request: ExecutableToolGateRequest) => {
      const gate: GateDescriptor = {
        executor: "relay",
        toolName: request.spec.name,
        specPermission: request.spec.permission,
        readOnlyHint: request.spec.readOnly,
        args: request.input,
      };
      const verdict = await responder.onPermission({
        id: request.id,
        availableReplies: ["once", "reject"],
        gate,
        raw: { spec: request.spec },
      });
      if (process.env.AGENTA_RUNNER_DEBUG_TOOLS) {
        log(
          `[executable-tool] ${request.toolName} id=${request.toolCallId} ` +
            `kind=${request.spec.kind} decision=${verdict.kind}`,
        );
      }
      if (verdict.kind === "allow") return { kind: "allow" };
      if (verdict.kind === "deny") {
        return {
          kind: "deny",
          reason: `Tool '${request.toolName}' was denied by policy.`,
        };
      }

      const correlatedId =
        toolCallIndex?.lookup(request.toolName, request.input) ??
        request.toolCallId;
      pause.markPausedToolCall(correlatedId);
      run.emitEvent({
        type: "interaction_request",
        id: request.id,
        kind: "user_approval",
        payload: {
          toolCallId: correlatedId,
          toolCall: {
            id: correlatedId,
            toolCallId: correlatedId,
            name: request.toolName,
            resolvedName: request.toolName,
            rawInput: request.input,
            input: request.input,
            kind: "execute",
          },
          availableReplies: ["once", "reject"],
        },
      });
      recordPendingInteraction(
        request.id,
        request.toolName,
        request.input,
        "user_approval",
      );
      return { kind: "pendingApproval" };
    },
    onPause: () => pause.pause(),
  };
}
