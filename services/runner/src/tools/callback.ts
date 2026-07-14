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

/**
 * Hard ceiling on the RAW wire body read off the socket, before any JSON parsing. Larger than
 * `MAX_BODY_BYTES` (the model-facing cap on the parsed `content` field) because the raw body is
 * a JSON envelope wrapping `content` plus its own quoting/escaping overhead — capping the raw
 * read at exactly `MAX_BODY_BYTES` would truncate the envelope itself and corrupt otherwise
 * well-formed JSON before it ever reaches `capToolResultText`. This is purely a memory-safety
 * backstop against a malformed/oversized upstream; `content` still gets capped to
 * `MAX_BODY_BYTES` after parsing, same as before.
 */
export const MAX_RAW_RESPONSE_BYTES = MAX_BODY_BYTES * 4;

/** How many trailing bytes of `buf[0..end)` are a truncated (incomplete) UTF-8 sequence that
 *  should be walked back past before decoding — otherwise `Buffer.toString` replaces the
 *  partial bytes with one or more U+FFFD (3 bytes each), which can push the decoded string
 *  back OVER `maxBytes` and make the reported omitted-byte count wrong (even negative). */
function trailingIncompleteUtf8Length(buf: Buffer, end: number): number {
  // Walk back at most 3 bytes (the longest continuation run before a lead byte) looking for
  // the start of a multibyte sequence that does not fully fit before `end`.
  const maxLead = Math.min(3, end);
  for (let back = 1; back <= maxLead; back++) {
    const byte = buf[end - back];
    if ((byte & 0xc0) === 0x80) continue; // continuation byte — keep walking back
    // Bytes needed for a sequence starting with this lead byte.
    const seqLen =
      (byte & 0xe0) === 0xc0
        ? 2
        : (byte & 0xf0) === 0xe0
          ? 3
          : (byte & 0xf8) === 0xf0
            ? 4
            : 1; // ASCII or an invalid lead byte — nothing incomplete to trim
    return seqLen > back ? back : 0;
  }
  return 0;
}

/** Truncate `text` to `maxBytes` (UTF-8) at a character boundary, signaling the cut the same
 *  way the replay transcript does (`transcript.ts` TOOL_RESULT_RENDER_MAX_CHARS) so the model
 *  can tell it was truncated. Guarantees the returned prefix is `<= maxBytes` and the omitted
 *  count is exact and non-negative — a byte-only cut can split a multibyte sequence, which
 *  decodes to U+FFFD and can push the result back over `maxBytes`. */
export function capToolResultText(text: string, maxBytes: number = MAX_BODY_BYTES): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return text;
  const safeEnd = maxBytes - trailingIncompleteUtf8Length(buf, maxBytes);
  const truncated = buf.subarray(0, safeEnd).toString("utf-8");
  return `${truncated} [... ${buf.length - safeEnd} bytes omitted]`;
}

/**
 * Read a fetch `Response` body incrementally, retaining at most `maxBytes` and cancelling the
 * underlying reader the moment the cap is crossed — so a malformed/oversized upstream response
 * cannot exhaust runner memory by first materializing the whole body (the failure mode
 * `response.text()` has). This is a raw memory-safety backstop, not the model-facing content
 * cap: callers still run the parsed `content` field through `capToolResultText` for the
 * "[... N bytes omitted]" signal: truncating here just stops the read early and, on truncation,
 * returns text at a UTF-8 character boundary (never a split multibyte sequence).
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number = MAX_RAW_RESPONSE_BYTES,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    return { text: await response.text(), truncated: false };
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > maxBytes) {
        // Keep only enough of this chunk to reach the cap, then stop pulling more.
        const keep = maxBytes - (size - chunk.length);
        if (keep > 0) chunks.push(chunk.subarray(0, keep));
        truncated = true;
        await reader.cancel("response exceeds max body size");
        break;
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }

  const buf = Buffer.concat(chunks);
  if (!truncated) return { text: buf.toString("utf-8"), truncated: false };
  const safeEnd = buf.length - trailingIncompleteUtf8Length(buf, buf.length);
  return { text: buf.subarray(0, safeEnd).toString("utf-8"), truncated: true };
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

  const { text: bodyText } = await readBoundedResponseText(response);
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
