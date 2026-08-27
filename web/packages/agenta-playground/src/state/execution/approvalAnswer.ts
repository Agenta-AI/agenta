// The durable half of a HITL approval decision: the row write, and what retires the gate marker.
// The RESUME has exactly one owner, the AI SDK's `sendAutomaticallyWhen`; a second dispatch from
// here raced it and each invoke cancelled the other's row. See docs/design/composio-tools-rework/.

/** The row resolution. `verdict` is the only key the runner reads; never add a second spelling. */
export function approvalResolution(approvalId: string, approved: boolean): Record<string, unknown> {
    return {
        tool_call_id: approvalId,
        verdict: approved ? "approved" : "denied",
    }
}

/** The `useChat` stream states, named so the rules below read as the SDK's own vocabulary. */
export type ChatStatusLike = "submitted" | "streaming" | "ready" | "error" | (string & {})

/** A resume request really went out: `submitted` is entered from `makeRequest` and nowhere else. */
export function isResumeSend({from, to}: {from: ChatStatusLike; to: ChatStatusLike}): boolean {
    return to === "submitted" && from !== "submitted"
}
