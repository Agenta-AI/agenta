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

/** The live-gate marker: an interaction, `null` (consumed or voided), or absent. */
export type ApprovalResumeMarker = {kind: string; id: string} | null | undefined

/**
 * Whether a resume held while the stream was busy should dispatch now. `null` means the marker was
 * already consumed — the SDK's own auto-resume fired, or a stop voided the gate — and a second
 * request must not go out.
 */
export function shouldDispatchHeldResume({
    busy,
    held,
    marker,
}: {
    busy: boolean
    held: boolean
    marker: ApprovalResumeMarker
}): boolean {
    if (busy || !held) return false
    return marker !== null
}

/**
 * What to do with the resume at decision time. Dispatching into an open stream is what the SDK's own
 * guard refuses, so a busy stream holds the resume until it settles.
 */
export const approvalResumeAction = (busy: boolean): "dispatch" | "hold" =>
    busy ? "hold" : "dispatch"
