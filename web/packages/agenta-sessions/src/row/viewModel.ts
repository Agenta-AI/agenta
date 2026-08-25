import type {SessionStream} from "@agenta/entities/session"

import type {SessionPending} from "../state/useSessionList"

import {sessionAgentId} from "./sessionAgent"
import {sessionPreviewText} from "./sessionPreview"
import {sessionRowStatus, type SessionRowStatusMeta} from "./sessionRowStatus"
import {sessionRowTitle} from "./sessionRowTitle"
import {
    isAutomationSession,
    sessionAutomation,
    sessionAutomationTitle,
    sessionDeliveryId,
    type SessionAutomationVm,
} from "./sessionTrigger"

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
     * The owning agent, from the row's workflow references (see `sessionAgentId`). Null when the
     * row names none — it has nowhere to open, so callers disable the action.
     */
    agentId: string | null
    /** ISO timestamp of last activity. Formatting relative time is the UI's job. */
    activityAt: string | null
    isAutomation: boolean
    automation: SessionAutomationVm | null
    deliveryId: string | null
    isPinned: boolean
    /** The wire row, for actions that need fields the view-model doesn't carry. */
    stream: SessionStream
}

export function sessionRowVm(
    row: SessionStream,
    {pinned, pending}: {pinned: boolean; pending: SessionPending | undefined},
): SessionRowVm {
    const automation = sessionAutomation(row)
    const {title, subtitle} = sessionRowTitle(
        row.name,
        sessionPreviewText(row),
        automation ? sessionAutomationTitle(automation) : null,
    )
    return {
        id: row.session_id,
        title,
        subtitle,
        status: sessionRowStatus(row, pending?.count),
        pending,
        agentId: sessionAgentId(row),
        activityAt: row.updated_at ?? row.created_at ?? null,
        isAutomation: isAutomationSession(row),
        automation,
        deliveryId: sessionDeliveryId(row),
        isPinned: pinned,
        stream: row,
    }
}
