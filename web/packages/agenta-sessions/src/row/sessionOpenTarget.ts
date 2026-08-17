import type {SessionStream} from "@agenta/entities/session"
import {isValidUUID} from "@agenta/shared/utils"
import {sessionAgentId} from "./sessionAgent"

import type {PendingSessionOpen} from "../state/pendingSessionOpen"

/**
 * The open target for a session list row, or `null` when it has none.
 *
 * A row's owning agent comes from its workflow references, so a session with no turns yet carries
 * none and cannot be opened on a playground — callers disable the action instead of navigating
 * somewhere wrong. `sessionAgentId` owns which reference that is.
 */
export function sessionOpenTarget(row: SessionStream): PendingSessionOpen | null {
    const appId = sessionAgentId(row)
    if (!appId) return null

    const title = row.name?.trim()
    return {appId, sessionId: row.session_id, title: title || undefined}
}
