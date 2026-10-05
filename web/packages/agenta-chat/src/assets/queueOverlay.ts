import type {FileUIPart} from "ai"

import type {QueuedMessage} from "../hooks/useAgentChatQueue"

/**
 * A queue write this tab made and shows before the snapshot does. `settledSeq` is null while the
 * write is in flight; once it lands, the first snapshot read past that sequence is the truth.
 */
export type QueueOp =
    | {kind: "remove"; settledSeq: number | null}
    | {kind: "sendNow"; settledSeq: number | null}
    | {kind: "edit"; text: string; fileParts?: FileUIPart[]; settledSeq: number | null}

export type QueueOps = Readonly<Record<string, QueueOp>>

/** Why a row's last action did not land, and the edit text it would otherwise have lost. */
export interface QueueRowError {
    message: string
    unsavedEdit?: {text: string; fileParts?: FileUIPart[]}
}

export type QueueRowErrors = Readonly<Record<string, QueueRowError>>

/** The server rows as this tab's writes leave them. Pure: hides, rewrites, and flags. */
export const applyQueueOps = (
    rows: readonly QueuedMessage[],
    ops: QueueOps,
    errors: QueueRowErrors,
): QueuedMessage[] => {
    const next: QueuedMessage[] = []
    for (const row of rows) {
        const op = ops[row.id]
        // Removed, or sent: the echo shows a sent row in the transcript.
        if (op && op.kind !== "edit") continue
        const error = errors[row.id]
        next.push({
            ...row,
            ...(op?.kind === "edit"
                ? {
                      text: op.text,
                      fileParts: op.fileParts ?? row.fileParts,
                      attachmentCount: op.fileParts?.length ?? row.attachmentCount,
                  }
                : {}),
            ...(error ? {error: error.message, unsavedEdit: error.unsavedEdit} : {}),
        })
    }
    return next
}

/**
 * Drop the ops the snapshot has caught up with. A sent row stays hidden while the server still
 * lists it: a send-now over a running turn waits for that turn to stop before it starts.
 */
export const pruneQueueOps = (
    ops: QueueOps,
    rows: readonly QueuedMessage[],
    viewSeq: number,
): QueueOps => {
    const listed = new Set(rows.map((row) => row.id))
    let changed = false
    const next: Record<string, QueueOp> = {}
    for (const [id, op] of Object.entries(ops)) {
        const caughtUp = op.settledSeq !== null && viewSeq > op.settledSeq
        if (caughtUp && (op.kind !== "sendNow" || !listed.has(id))) {
            changed = true
            continue
        }
        next[id] = op
    }
    return changed ? next : ops
}

/** Errors for rows still on screen; a row that left the queue takes its error with it. */
export const pruneQueueRowErrors = (
    errors: QueueRowErrors,
    rows: readonly QueuedMessage[],
): QueueRowErrors => {
    const listed = new Set(rows.map((row) => row.id))
    const kept = Object.entries(errors).filter(([id]) => listed.has(id))
    return kept.length === Object.keys(errors).length ? errors : Object.fromEntries(kept)
}
