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
export const selectApprovalTargets = (
    rows: SessionInteraction[] | null | undefined,
    target: ApprovalTarget,
): SessionInteraction[] => {
    const pending = (rows ?? []).filter((row) => row.kind === "user_approval" && !!row.id)
    if (target.all) return pending
    return pending.filter((row) => row.token === target.approvalId)
}
