/**
 * A model call that ends with `finish_reason: malformed_function_call`: Gemini wrote a tool call
 * it could not encode (Google: invalid model-generated syntax). The same request may succeed on a
 * second try, so Pi retries it once; a second broken tool call in a row ends the turn with a
 * sentence the person can act on.
 *
 * Pi's own auto-retry does the retry: it drops the failed attempt from what the model sees, waits,
 * and sends the same request again. Pi does not count this finish reason as retryable, so the
 * session's retry check is widened for it alone, with a budget of one retry per run of failures.
 */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { MALFORMED_TOOL_CALL, MALFORMED_TOOL_CALL_MESSAGE, withPublicCode } from "../../sandbox_agent/errors.ts";

export const MALFORMED_TOOL_CALL_TWICE_MESSAGE = "The model returned a broken tool call twice. Send the message again.";

export function isMalformedToolCall(text: unknown): boolean {
  return typeof text === "string" && MALFORMED_TOOL_CALL.test(text);
}

interface RetryCheck {
  _isRetryableError?: (message: { errorMessage?: string }) => boolean;
}

export interface MalformedToolCallRetry {
  /** True once this run of failures was retried, so a further failure is the second one. */
  retried(): boolean;
  stop(): void;
}

/** Let `session` retry one malformed tool call. The retry budget comes back once a model call succeeds. */
export function retryMalformedToolCallOnce(session: AgentSession): MalformedToolCallRetry {
  const check = session as unknown as RetryCheck;
  const original = check._isRetryableError;
  // Pinned by a unit test against the installed Pi: an upgrade that renames the check fails there.
  if (typeof original !== "function") throw new Error("Pi's AgentSession has no _isRetryableError: the malformed tool call retry needs updating");
  let retried = false;
  check._isRetryableError = (message) => (isMalformedToolCall(message?.errorMessage) ? !retried : original.call(session, message));
  const stop = session.subscribe((event) => {
    if (event.type === "auto_retry_start" && isMalformedToolCall(event.errorMessage)) retried = true;
    if (event.type === "message_end" && event.message.role === "assistant" && (event.message as { stopReason?: string }).stopReason !== "error") retried = false;
  });
  return { retried: () => retried, stop };
}

/**
 * The error a turn ends with on a malformed tool call, or undefined for any other error. Pi's
 * retry budget is shared with other failures, so the turn can end here without the retry.
 */
export function malformedToolCallError(err: unknown, retried: boolean): Error | undefined {
  if (!isMalformedToolCall(err instanceof Error ? err.message : err)) return undefined;
  const message = retried ? MALFORMED_TOOL_CALL_TWICE_MESSAGE : MALFORMED_TOOL_CALL_MESSAGE;
  // The ACP `RequestError.internalError` shape the runner's error classifiers read.
  return withPublicCode(Object.assign(new Error(message), { name: "RequestError", code: -32603 }), "malformed_tool_call");
}
