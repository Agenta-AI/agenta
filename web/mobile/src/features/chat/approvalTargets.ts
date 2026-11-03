import type {SessionInteraction} from "@agenta/entities/session"

/** Which pending gates a tap answers: one gate (by transcript approval id) or every gate. */
export type ApprovalTarget = {all: true} | {all?: false; approvalId: string}

/**
 * Pick the interaction rows to respond to.
 *
 * The transcript's approval id is the row's `token` (both come from the runner's
 * `interaction_request` event id), but `/sessions/interactions/{id}/respond` keys on the
 * row's `id` — so a row without an `id` is unanswerable and is dropped.
 */
/**
 * Has the resume we fired settled?
 *
 * Keyed on the ids we actually answered, never on how many gates are pending. Answering the
 * last gate of a turn commonly raises the next one in the same poll, so a count-based check
 * sees one before and one after and never settles — leaving every approval button disabled
 * until the failure-path timeout.
 */
export const hasSettledResume = (
    submittedApprovalIds: readonly string[],
    pendingApprovalIds: readonly string[],
): boolean => {
    if (submittedApprovalIds.length === 0) return true
    const pending = new Set(pendingApprovalIds)
    return !submittedApprovalIds.some((id) => pending.has(id))
}

export const selectApprovalTargets = (
    rows: SessionInteraction[] | null | undefined,
    target: ApprovalTarget,
): SessionInteraction[] => {
    const pending = (rows ?? []).filter((row) => row.kind === "user_approval" && !!row.id)
    if (target.all) {
        const executionIds = new Set(pending.map((row) => row.turn_id ?? null))
        if (executionIds.size > 1) {
            throw new Error("Approve all can only answer approvals from one execution.")
        }
        return pending
    }
    return pending.filter((row) => row.token === target.approvalId)
}
