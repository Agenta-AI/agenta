/**
 * The server preview on the approval card of an agent write.
 *
 * When the gate of `edit_agent_config` or `create_agent` is about to ask a person, the runner
 * asks the API what the call would change (`tools.agenta.preview_agent_change`). The API runs the
 * change-set engine on the base the call names and saves nothing; the answer (old and new value
 * per changed path, and whether each operation applies) rides the approval event as `preview`.
 *
 * The preview is a convenience for the person, not a condition of the gate: any failure (no
 * callback, a refusal, a timeout, a malformed answer) gives no preview and the card still opens
 * with the proposed values alone. That is the opposite of the `@ag.file` manifest, which fails
 * the gate closed, because the call here carries every value inline and the card can show them.
 */
import type { ResolvedToolSpec, RunContext } from "../protocol.ts";
import { callAgentaTool } from "./callback.ts";
import { applyContextBindings, stripEphemeralArgs } from "./direct.ts";
import type { ToolCallbackRuntime } from "./run-credential.ts";

const PREVIEW_CALL_REF = "tools.agenta.preview_agent_change";

/** The writes the API can preview, by the call ref their spec carries. */
const PREVIEWED_CALL_REFS = new Set([
  "tools.agenta.edit_agent_config",
  "tools.agenta.create_agent",
]);

/** The card waits for this answer, so it is short; the API's own read budget is longer. */
const PREVIEW_TIMEOUT_MS = 10_000;

export type AgentChangePreviewFetcher = (input: {
  toolName: string | undefined;
  toolCallId: string | undefined;
  args: unknown;
}) => Promise<Record<string, unknown> | undefined>;

export function buildAgentChangePreviewFetcher(input: {
  callback: ToolCallbackRuntime | undefined;
  runContext: RunContext | undefined;
  toolSpecs: ResolvedToolSpec[];
  signal?: AbortSignal;
  log?: (message: string) => void;
}): AgentChangePreviewFetcher {
  const specsByName = new Map(
    input.toolSpecs.map((spec) => [spec.name, spec] as const),
  );
  return async ({ toolName, toolCallId, args }) => {
    const spec = toolName ? specsByName.get(toolName) : undefined;
    if (!spec?.callRef || !PREVIEWED_CALL_REFS.has(spec.callRef))
      return undefined;
    const endpoint = input.callback?.endpoint;
    if (!endpoint) return undefined;
    try {
      // The arguments the call itself would send: the note for the person removed, and the
      // caller bindings filled from run context, so the API resolves the same target.
      const callArgs = applyContextBindings(
        stripEphemeralArgs(args, spec.ephemeralArgs),
        spec.contextBindings ?? {},
        input.runContext,
      );
      const raw = await callAgentaTool(
        endpoint,
        input.callback?.credential(),
        PREVIEW_CALL_REF,
        `preview-${toolCallId ?? spec.name}`,
        { tool: spec.callRef, arguments: callArgs },
        { signal: input.signal, timeoutMs: PREVIEW_TIMEOUT_MS },
      );
      const preview: unknown = JSON.parse(raw);
      if (!preview || typeof preview !== "object" || Array.isArray(preview)) {
        throw new Error("the preview answer is not an object");
      }
      return preview as Record<string, unknown>;
    } catch (error) {
      input.log?.(
        `[HITL] approval preview unavailable tool=${spec.name}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  };
}
