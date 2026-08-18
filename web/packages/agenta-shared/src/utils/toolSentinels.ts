/**
 * Runner pause sentinels, mirrored from `services/runner/src/tracing/otel.ts`. When a turn pauses
 * on an approval, the runner force-settles the sibling tool calls with an error-shaped result
 * whose text starts with one of these codes. They report skipped or unobserved work — never a
 * final failure — so renderers treat them as non-terminal.
 */

export const DEFERRED_NOT_EXECUTED_PREFIX = "DEFERRED_NOT_EXECUTED"

export const APPROVED_EXECUTION_RESULT_UNKNOWN =
    "APPROVED_EXECUTION_RESULT_UNKNOWN: the approved call started but its result was not observed before the pause ended the turn; do not assume it failed and do not retry a side-effecting call."

export const APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX = APPROVED_EXECUTION_RESULT_UNKNOWN.slice(
    0,
    APPROVED_EXECUTION_RESULT_UNKNOWN.indexOf(":"),
)

/** True when a tool result's errorText is a runner pause sentinel (deferred or unobserved work),
 * not a real failure. Prefix match: the code is the contract, the prose after the colon isn't. */
export function isDeferredToolSentinel(errorText: unknown): boolean {
    return (
        typeof errorText === "string" &&
        (errorText.startsWith(DEFERRED_NOT_EXECUTED_PREFIX) ||
            errorText.startsWith(APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX))
    )
}
