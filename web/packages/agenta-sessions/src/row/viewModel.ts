import type {SessionStream} from "@agenta/entities/session"
import {isValidUUID} from "@agenta/shared/utils"

import type {SessionPending} from "../state/useSessionList"

import {sessionPreviewText} from "./sessionPreview"
import {pendingGateLabel, sessionRowStatus, type SessionRowStatusMeta} from "./sessionRowStatus"
import {sessionRowTitle} from "./sessionRowTitle"
import {isAutomationSession, sessionTriggerName} from "./sessionTrigger"

/**
 * A session row with nothing left to decide: every precedence rule (title, status, preview,
 * trigger) is applied here, so a surface renders fields instead of re-deriving them — and every
 * surface agrees on what a row says.
 */
export interface SessionRowVm {
    id: string
    title: string
    /** Null when the title IS the message — a row never prints the same text twice. */
    subtitle: string | null
    status: SessionRowStatusMeta
    pending: SessionPending | undefined
    /**
     * The owning agent, from the latest turn's references. Null when the session has no turns
     * yet — such a row has nowhere to open, so callers disable the action.
     */
    agentId: string | null
    /** ISO timestamp of last activity. Formatting relative time is the UI's job. */
    activityAt: string | null
    isAutomation: boolean
    isPinned: boolean
    /** The wire row, for actions that need fields the view-model doesn't carry. */
    stream: SessionStream
}

export function sessionRowVm(
    row: SessionStream,
    {pinned, pending}: {pinned: boolean; pending: SessionPending | undefined},
): SessionRowVm {
    const {title, subtitle} = sessionRowTitle(
        row.name,
        sessionPreviewText(row),
        sessionTriggerName(row),
    )
    const status = sessionRowStatus(row, pending?.count)
    return {
        id: row.session_id,
        title,
        subtitle,
        // One source for the chip text: a waiting chip names WHAT is being asked, so surfaces
        // render `status.chipLabel` and never re-derive it from the gate kinds themselves.
        status: status.chipLabel
            ? {...status, chipLabel: pendingGateLabel(pending?.kinds)}
            : status,
        pending,
        agentId: row.references?.find((ref) => ref.id && isValidUUID(ref.id))?.id ?? null,
        activityAt: row.updated_at ?? row.created_at ?? null,
        isAutomation: isAutomationSession(row),
        isPinned: pinned,
        stream: row,
    }
}
