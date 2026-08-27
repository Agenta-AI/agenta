/**
 * The durable half of a HITL approval decision.
 *
 * The part-state route is structurally racy for a gateway approval: the run stream stays open while
 * the card is up, so the AI SDK skips its own resume dispatch (`status === "streaming"`), and when
 * the stream finally ends the transcript can be re-seeded from the stored record — which discards
 * the local `approval-responded` flip before anything retries.
 *
 * So the decision goes to the interaction row the runner parked (`kind: "user_approval"`), and the
 * resume is dispatched deliberately rather than inferred from part state. The runner seeds its
 * decision store from those rows at turn start, so a resumed run may legitimately carry
 * `approval-requested` in its history and still execute.
 *
 * Pure, so both `useChat` hosts share one implementation and the ordering is testable without React.
 */

/**
 * The resolution written onto the row, in the shape the runner's read path expects.
 *
 * `verdict` is the decision, exactly `"approved"` or `"denied"` — the runner reads this key and no
 * other, so do not add a second spelling beside it. A gateway approval's id IS its tool call id
 * (the runner stamps the same composite `call_…|fc_…` onto `data.request.tool_call_id`), which is
 * how the answer finds the row; it is echoed here the way the client-tool rows echo theirs.
 *
 * The row is transitioned to `responded`, never `resolved`: `resolved` means the runner has
 * consumed the decision, so writing it from here would make the approval look already-used and it
 * would be dropped in silence.
 */
export function approvalResolution(approvalId: string, approved: boolean): Record<string, unknown> {
    return {
        tool_call_id: approvalId,
        verdict: approved ? "approved" : "denied",
    }
}

/** The `useChat` stream states, named so the rules below read as the SDK's own vocabulary. */
export type ChatStatusLike = "submitted" | "streaming" | "ready" | "error" | (string & {})

/**
 * Whether a status change means a request really went out.
 *
 * `submitted` is entered from one place only — the SDK's `makeRequest` — so this transition IS a
 * send, whoever started it. That makes it the only trustworthy evidence of a dispatch: the resume
 * predicate's `true` is not evidence, because the SDK's finish path reads
 * `if (predicate(...) && !isError)` and discards the verdict on an errored stream. A hold released
 * on the predicate's word is a hold released for a request that never left.
 */
export function isResumeSend({from, to}: {from: ChatStatusLike; to: ChatStatusLike}): boolean {
    return to === "submitted" && from !== "submitted"
}

/**
 * What to do with a held resume, on each stream-state change.
 *
 * `release` means someone else already sent, so the hold is satisfied without a second request.
 * `dispatch` means the stream settled with nothing sent — the gateway case, where the stream ends
 * by erroring and the SDK therefore skips its own resume.
 */
export function heldResumeDecision({
    busy,
    held,
    sent,
}: {
    busy: boolean
    held: boolean
    sent: boolean
}): "wait" | "dispatch" | "release" {
    if (!held) return "wait"
    if (sent) return "release"
    if (busy) return "wait"
    return "dispatch"
}

/**
 * What to do with the resume at decision time. Dispatching into an open stream is what the SDK's own
 * guard refuses, so a busy stream holds the resume until it settles.
 */
export const approvalResumeAction = (busy: boolean): "dispatch" | "hold" =>
    busy ? "hold" : "dispatch"
