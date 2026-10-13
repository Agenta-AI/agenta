import type {FileUIPart} from "ai"

import type {QueuedMessage} from "../hooks/useAgentChatQueue"

/** A write shown before the snapshot has it; `settledSeq` is null while it is in flight. */
export type QueueOpBody =
    | {kind: "remove"; settledSeq: number | null}
    | {kind: "sendNow"; settledSeq: number | null}
    | {kind: "edit"; text: string; fileParts?: FileUIPart[]; settledSeq: number | null}

/** `token` names the write that owns the row's overlay; only it may settle or undo it. */
export type QueueOp = QueueOpBody & {token: number}

export type QueueOps = Readonly<Record<string, QueueOp>>

/** `unsavedEdit` keeps a refused edit so it is not lost. */
export interface QueueRowError {
    message: string
    unsavedEdit?: {text: string; fileParts?: FileUIPart[]}
}

export type QueueRowErrors = Readonly<Record<string, QueueRowError>>

/** The server rows as this tab's pending writes leave them. */
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
                      // Not sendable or editable again until this edit has saved.
                      ...(op.settledSeq === null ? {editable: false, saving: true} : {}),
                  }
                : {}),
            ...(error ? {error: error.message, unsavedEdit: error.unsavedEdit} : {}),
        })
    }
    return next
}

/** A sent row stays hidden while listed: over a running turn it waits for the stop. */
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

/** A row that left the queue takes its error with it. */
export const pruneQueueRowErrors = (
    errors: QueueRowErrors,
    rows: readonly QueuedMessage[],
): QueueRowErrors => {
    const listed = new Set(rows.map((row) => row.id))
    const kept = Object.entries(errors).filter(([id]) => listed.has(id))
    return kept.length === Object.keys(errors).length ? errors : Object.fromEntries(kept)
}
