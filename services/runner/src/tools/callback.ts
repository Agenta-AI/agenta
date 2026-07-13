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

/** Bound a tool result body so a malformed/oversized upstream response cannot exhaust runner
 *  memory or blow out the model's context. Same cap and mechanism as tool-mcp-http.ts. */
export const MAX_BODY_BYTES = 1_000_000;

/** Truncate `text` to `maxBytes` (UTF-8), signaling the cut the same way the replay transcript
 *  does (`transcript.ts` TOOL_RESULT_RENDER_MAX_CHARS) so the model can tell it was truncated. */
export function capToolResultText(text: string, maxBytes: number = MAX_BODY_BYTES): string {
  const bytes = Buffer.byteLength(text, "utf-8");
  if (bytes <= maxBytes) return text;
  const truncated = Buffer.from(text, "utf-8").subarray(0, maxBytes).toString("utf-8");
  return `${truncated} [... ${bytes - Buffer.byteLength(truncated, "utf-8")} bytes omitted]`;
}

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
    // Keep the upstream response body server-side; the model gets only the status code
    // (mirrors tools/direct.ts). A non-2xx here is an infrastructure/config fault — a
    // correctable tool failure arrives as 200 + STATUS_CODE_ERROR and is surfaced below.
    console.error(
      `tool call ${callRef} returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
    );
    throw new Error(`tool call ${callRef} failed: HTTP ${response.status}`);
  }

  // ToolCallResponse -> { call: { data: { content }, status } }. `content` is the
  // execution result serialized as a JSON string; hand it to the model, capped (an
  // uncapped result — e.g. a discover_tools dump — is otherwise handed back verbatim).
  try {
    const parsed = JSON.parse(bodyText);
    const content = parsed?.call?.data?.content;
    // A business-level tool failure rides a 200 as STATUS_CODE_ERROR with the upstream
    // message in `status.message` (api .../tools/router.py `call_tool`). It is gateway-shaped,
    // not an opaque upstream body, and it is what lets the model fix a bad argument — so
    // surface it BY DESIGN rather than relying on it happening to ride `content`.
    const status = parsed?.call?.status;
    const statusMessage =
      status?.code === "STATUS_CODE_ERROR" && typeof status?.message === "string"
        ? status.message
        : undefined;
    if (statusMessage) {
      const detail = typeof content === "string" ? content : "";
      return capToolResultText(
        detail
          ? `tool call ${callRef} failed: ${statusMessage}\n${detail}`
          : `tool call ${callRef} failed: ${statusMessage}`,
      );
    }
    if (typeof content === "string") return capToolResultText(content);
    if (content != null) return capToolResultText(JSON.stringify(content));
    return capToolResultText(bodyText);
  } catch {
    return capToolResultText(bodyText);
  }
}
