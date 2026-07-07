/**
 * Shared Agenta /tools/call callback transport.
 *
 * One implementation of the tool round-trip used by every delivery path:
 *  - extensions/agenta.ts registerTools (Pi under sandbox-agent/ACP, via the bundled extension)
 *  - tools/mcp-server.ts (the MCP stdio bridge for non-Pi harnesses)
 *
 * Each call POSTs the OpenAI-style envelope to Agenta's /tools/call, so the Composio key
 * and connection auth stay server-side. Keeping the request envelope and response parse in
 * one place means a change to the /tools/call contract is a one-line edit, not several.
 */
export type { ResolvedToolSpec, ToolCallbackContext } from "../protocol.ts";

/** Per-tool budget (ms) for the /tools/call round-trip. Surfaced as a tool error on timeout. */
export const TOOL_CALL_TIMEOUT_MS = Number(
  process.env.AGENTA_AGENT_TOOLS_TIMEOUT ?? 30000,
);

/** Permissive default when a resolved tool has no input schema. */
export const EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

export interface CallAgentaToolOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  runKind?: string;
}

function callbackFetchTimeoutMs(timeoutMs: number | undefined): number {
  // A positive spec timeout caps the server-side child run. The host fetch gets
  // a short grace window so digest/span work produced after the child ceiling
  // is not lost to an abort at the same deadline.
  return timeoutMs && timeoutMs > 0
    ? timeoutMs + 10_000
    : TOOL_CALL_TIMEOUT_MS;
}

/**
 * One /tools/call round-trip. Returns the result text; throws on failure. Callers turn a
 * throw into a tool-error result so the model loop continues rather than crashing the run.
 * An optional caller `signal` is combined with the per-tool timeout.
 */
export async function callAgentaTool(
  endpoint: string,
  authorization: string | undefined,
  callRef: string,
  toolCallId: string,
  args: unknown,
  options: CallAgentaToolOptions = {},
): Promise<string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers["authorization"] = authorization;
  if (options.runKind) headers["x-agenta-run-kind"] = options.runKind;

  const timeoutSignal = AbortSignal.timeout(
    callbackFetchTimeoutMs(options.timeoutMs),
  );
  const anyOf = (AbortSignal as any).any;
  const combined =
    options.signal && typeof anyOf === "function"
      ? anyOf([options.signal, timeoutSignal])
      : timeoutSignal;

  const dbg = process.env.AGENTA_RUNNER_DEBUG_TOOLS ? console.error : undefined;
  dbg?.(`[tool-call] -> ${callRef} POST ${endpoint} auth=${authorization ? "yes" : "no"}`);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          id: toolCallId,
          type: "function",
          // Arguments as an object (not a JSON string) to avoid double-encoding.
          function: { name: callRef, arguments: args ?? {} },
        },
      }),
      signal: combined,
    });
  } catch (err) {
    dbg?.(`[tool-call] !! ${callRef} transport error: ${err instanceof Error ? err.message : err}`);
    throw new Error(
      `tool call ${callRef} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const bodyText = await response.text();
  dbg?.(`[tool-call] <- ${callRef} HTTP ${response.status} body=${bodyText.slice(0, 300)}`);
  if (!response.ok) {
    throw new Error(
      `tool call ${callRef} returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
    );
  }

  // ToolCallResponse -> { call: { data: { content }, status } }. `content` is the
  // execution result serialized as a JSON string; hand it to the model verbatim.
  try {
    const parsed = JSON.parse(bodyText);
    const content = parsed?.call?.data?.content;
    if (typeof content === "string") return content;
    if (content != null) return JSON.stringify(content);
    return bodyText;
  } catch {
    return bodyText;
  }
}
