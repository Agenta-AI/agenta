/**
 * The runner parks only ONE interaction per turn; a second `request_connection` in the same step is
 * force-settled with this sentinel and RE-REQUESTED next turn (services/runner otel.ts
 * `TOOL_NOT_EXECUTED_PAUSED`). It is a deferral, not a failure — render it quietly with no Retry, so
 * the user waits for the agent's re-ask instead of starting a flow that races it.
 */
export const DEFERRED_SENTINEL = "DEFERRED_NOT_EXECUTED"

/** True when the runner force-settled this client-tool part as deferred, not failed. */
export const isDeferredByRunner = (part: {state?: unknown; errorText?: unknown}): boolean =>
    part.state === "output-error" &&
    typeof part.errorText === "string" &&
    part.errorText.startsWith(DEFERRED_SENTINEL)
