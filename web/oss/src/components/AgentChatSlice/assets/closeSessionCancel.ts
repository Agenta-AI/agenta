import {type SessionRunStatus} from "@agenta/chat/model"

/**
 * Kill switch, off while the close-time cancel is held back.
 *
 * Flip to `true` to restore the behaviour described below; nothing else has to change, and
 * `closeSessionCancel.test.ts` pins both sides of this flag.
 */
export const CLOSE_CANCELS_RUN = false

export interface CloseSessionCancelInputs {
    /** This browser's run-state for the session whose tab is being closed. */
    status: SessionRunStatus
    /** Absent before a project resolves; the cancel command is project-scoped. */
    projectId: string | null | undefined
}

/**
 * Does closing this tab need the cooperative cancel the Stop button sends?
 *
 * Unmounting the pane only aborts THIS browser's fetch. The runner keeps going and keeps the
 * session's alive lock, so the reopened tab reads as running-elsewhere until the lock's TTL
 * expires — the stuck session in #6296.
 *
 * `awaiting` is deliberately excluded: a parked approval is durable and meant to be answered
 * later, so closing its tab must not throw the turn away.
 */
export const shouldCancelRunOnClose = ({status, projectId}: CloseSessionCancelInputs): boolean =>
    CLOSE_CANCELS_RUN && Boolean(projectId) && status === "running"
