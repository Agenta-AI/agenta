/**
 * The durable half of a HITL approval decision.
 *
 * The part-state route is structurally racy for a gateway approval: the run stream stays open while
 * the card is up, and when it ends the transcript can be re-seeded from the stored record, which
 * discards the local `approval-responded` flip. So the decision also goes to the interaction row the
 * runner parked (`kind: "user_approval"`). The runner seeds its decision store from those rows at
 * turn start, so a resumed run may legitimately carry `approval-requested` in its history and still
 * execute.
 *
 * The RESUME, by contrast, has exactly one owner: the AI SDK's own `sendAutomaticallyWhen`. A park
 * stream ends with a clean finish, so the SDK's dispatch fires, and a second compensating dispatch
 * from here sent two invokes 1 ms apart — each cancelling the other's interaction row as stale.
 *
 * Pure, so both `useChat` hosts share one implementation and the rules are testable without React.
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
 * Whether a status change means a resume request really went out.
 *
 * `submitted` is entered from one place only — the SDK's `makeRequest` — so this transition IS a
 * send. It is what retires the live-gate marker: the predicate's `true` is not evidence of a send,
 * because the SDK's finish path reads `if (predicate(...) && !isError)` and can still refuse.
 */
export function isResumeSend({from, to}: {from: ChatStatusLike; to: ChatStatusLike}): boolean {
    return to === "submitted" && from !== "submitted"
}
