/**
 * Shared Agenta /tools/call callback transport.
 *
 * One implementation of the tool round-trip used by every delivery path:
 *  - extensions/agenta.ts registerTools (Pi under sandbox-agent/ACP, via the bundled extension)
 *  - the internal MCP channels used by non-Pi harnesses
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
 *  memory. Same cap and mechanism as tool-mcp-http.ts. This is a memory-safety ceiling, not the
 *  model-facing content budget — see `MAX_GATEWAY_RESULT_BYTES` below for that. */
export const MAX_BODY_BYTES = 1_000_000;

/**
 * Hard ceiling on the RAW wire body read off the socket, before any JSON parsing. Larger than
 * `MAX_BODY_BYTES` because the raw body is a JSON envelope wrapping `content` plus its own
 * quoting/escaping overhead — capping the raw read at exactly `MAX_BODY_BYTES` would truncate
 * the envelope itself and corrupt otherwise well-formed JSON before it ever reaches
 * `capToolResultText`. This is purely a memory-safety backstop against a malformed/oversized
 * upstream; the parsed `content` field is capped far tighter, to `MAX_GATEWAY_RESULT_BYTES`,
 * before it ever reaches the model.
 */
export const MAX_RAW_RESPONSE_BYTES = MAX_BODY_BYTES * 4;

/**
 * Model-facing cap on ONE gateway/Composio tool result, well below `MAX_BODY_BYTES`. A single
 * `get_pull_request` call was observed returning ~1 MB (~241,000 tokens) of `content`, which blew
 * out the whole conversation's context in one turn (issue #5341). `MAX_BODY_BYTES` stays as the
 * outer memory-safety ceiling on the raw transport; this is the much tighter budget the model
 * itself should ever see from a gateway call, so an oversized result reads as "narrow your query"
 * rather than "here is a wall of text, good luck." ~100,000 bytes approximates 25,000 tokens at
 * the usual ~4 bytes/token for English/JSON text. Env-overridable like the other budgets in this
 * file (e.g. TOOL_CALL_TIMEOUT_MS above).
 */
export const DEFAULT_GATEWAY_RESULT_BYTES = 100_000;

/** Parse a gateway-result byte budget from an env value, falling back to `fallback` for anything
 *  that is not a positive safe integer. A bare `Number()` would accept `"Infinity"` (which would
 *  disable the cap), negative values (which make the byte slice keep almost the whole result),
 *  fractions, and `NaN`, so all of those fall back to the default instead. */
export function resolveGatewayResultBytes(
  raw: string | undefined,
  fallback: number = DEFAULT_GATEWAY_RESULT_BYTES,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const MAX_GATEWAY_RESULT_BYTES = resolveGatewayResultBytes(
  process.env.AGENTA_AGENT_TOOLS_GATEWAY_RESULT_MAX_BYTES,
);

/** Appended in place of the omitted tail when a gateway result is cut at
 *  `MAX_GATEWAY_RESULT_BYTES`, steering the model to narrow the call instead of retrying blind. */
export const GATEWAY_RESULT_STEERING_MESSAGE =
  "This result was too large to return in full. Narrow your query (add filters, a smaller " +
  "date range, or specific fields), request a summary, or paginate and fetch fewer items " +
  "per call, then try again.";

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

/** Truncate `text` so the WHOLE returned string (the retained prefix plus the omitted-count
 *  marker and any `steeringMessage`) stays within `maxBytes` (UTF-8), cutting at a character
 *  boundary so a multibyte sequence is never split. Room for the suffix is reserved before the
 *  prefix is chosen, so the budget bounds the entire result, not just the prefix; when `maxBytes`
 *  is smaller than the suffix itself, the suffix alone is returned. The cut is signaled the same
 *  way the replay transcript does (`transcript.ts` TOOL_RESULT_RENDER_MAX_CHARS) so the model can
 *  tell it was truncated, and the optional `steeringMessage` tells it what to do about the cut
 *  (narrow, filter, paginate) instead of leaving it to guess from a bare truncation notice. */
export function capToolResultText(
  text: string,
  maxBytes: number = MAX_BODY_BYTES,
  steeringMessage?: string,
): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return text;
  // The omitted-byte count is at most the whole buffer length, so `buf.length` bounds the
  // marker's digit width. Reserving against that upper bound keeps the final string within
  // `maxBytes` whenever `maxBytes` can hold the suffix at all.
  const suffixFor = (omitted: number): string => {
    const marker = ` [... ${omitted} bytes omitted]`;
    return steeringMessage ? `${marker}\n\n${steeringMessage}` : marker;
  };
  const reservedForSuffix = Buffer.byteLength(suffixFor(buf.length), "utf-8");
  const prefixBudget = Math.max(0, maxBytes - reservedForSuffix);
  const safeEnd = Math.max(
    0,
    prefixBudget - trailingIncompleteUtf8Length(buf, prefixBudget),
  );
  const truncated = buf.subarray(0, safeEnd).toString("utf-8");
  return `${truncated}${suffixFor(buf.length - safeEnd)}`;
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
  //
  // THE TRY WRAPS THE PARSE AND NOTHING ELSE, ON PURPOSE. It used to wrap the whole block, so a
  // `throw` below would have been caught by its own fallback and turned back into a success. The
  // narrow scope is what lets a failure leave this function as a failure.
  let parsed: any;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return capToolResultText(bodyText, MAX_GATEWAY_RESULT_BYTES, GATEWAY_RESULT_STEERING_MESSAGE);
  }

  const content = parsed?.call?.data?.content;
  const status = parsed?.call?.status;
  const detail =
    typeof content === "string"
      ? content
      : content != null
        ? JSON.stringify(content)
        : "";

  // A business-level tool failure rides a 200 as STATUS_CODE_ERROR (api .../tools/router.py
  // `call_tool`). It is gateway-shaped, not an opaque upstream body, and it is what lets the
  // model fix a bad argument.
  //
  // CONTRACT: THIS THROWS, AND IT USED TO RETURN. Every caller turns a throw into a tool ERROR,
  // so the model reads a failed call as failed. Returning made `startToolRelay` write
  // `{ok: true, text}`, which the MCP shim renders as `isError: false`: the model was told its
  // call SUCCEEDED and handed the failure text as the result. On Codex that is the blank-success
  // shape that makes a model invent an explanation and tell the user to try again. Measured in
  // all three arms before this change; every one of them returned.
  //
  // `status.code` ALONE decides. The old test also required `status.message` to be a string, so a
  // failure whose message was absent or null fell through to the success return below. That arm is
  // not hypothetical: it is the shape a handler-mode op produces when its error envelope lives in
  // `content`.
  //
  // `detail` is passed through rather than redacted, and the reason is a SYMMETRY INVARIANT rather
  // than an argument about what can reach this line.
  //
  // Every producer of a `ToolResult` in the tools router serializes ONE content expression and
  // branches only on `status.code`. The Composio arm sends `json.dumps(execution_result...)`, the
  // workflow arm `json.dumps(outputs)`, the handler seam whatever the handler returned. So the
  // failure branch hands the model exactly what the success branch hands it, from the same
  // expression. Redacting on failure would strip a value we give away freely one branch earlier:
  // if that content can leak a secret, it leaks on SUCCESS, where nothing redacts it. The failure
  // branch is not where that question lives, and scrubbing third-party output, if it is ever
  // wanted, is both-branches work needing its own justification.
  //
  // WHAT A REVIEWER SHOULD NOTICE: a new producer that serializes DIFFERENT content on its two
  // branches. None does today. The handler seam varies its content (an envelope on failure, the
  // op's payload on success), but it does so INSIDE the handler, above the router's single
  // expression, and that is the sanctioned case rather than the surprising one.
  //
  // The narrower guards are untouched and still carry their own weight: a proxy's HTML error page
  // fails the JSON parse above, and a non-2xx is redacted to its status code further up.
  if (status?.code === "STATUS_CODE_ERROR") {
    const reason =
      typeof status?.message === "string" && status.message
        ? `tool call ${callRef} failed: ${status.message}`
        : `tool call ${callRef} failed`;
    throw new Error(
      capToolResultText(
        detail ? `${reason}\n${detail}` : reason,
        MAX_GATEWAY_RESULT_BYTES,
        GATEWAY_RESULT_STEERING_MESSAGE,
      ),
    );
  }

  if (typeof content === "string") {
    return capToolResultText(content, MAX_GATEWAY_RESULT_BYTES, GATEWAY_RESULT_STEERING_MESSAGE);
  }
  if (content != null) {
    return capToolResultText(detail, MAX_GATEWAY_RESULT_BYTES, GATEWAY_RESULT_STEERING_MESSAGE);
  }
  return capToolResultText(bodyText, MAX_GATEWAY_RESULT_BYTES, GATEWAY_RESULT_STEERING_MESSAGE);
}
