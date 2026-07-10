import {querySessionRecords} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import type {UIMessage} from "ai"
import {getDefaultStore} from "jotai"

import {transcriptToMessages} from "./transcriptToMessages"

/**
 * Server-side hydration seam for a session's conversation.
 *
 * The durable Sessions API (PR #4916) persists every ACP `AgentEvent` to an append-only
 * record log; `queryRecords` is the replay source. This maps those events to v6 `UIMessage[]`
 * (see `transcriptToMessages`) so opening a session from a deep link / observability trace
 * renders a conversation this browser never ran.
 *
 * Returns `null` when there is no server history (project scope missing, request failed, or
 * the record log is empty — e.g. the ingest worker isn't running locally). The caller then
 * falls back to whatever is already in localStorage.
 */
export const loadSessionMessages = async (sessionId: string): Promise<UIMessage[] | null> => {
    const projectId = getDefaultStore().get(projectIdAtom)
    if (!projectId) return null

    const records = await querySessionRecords({sessionId, projectId})
    if (!records || records.length === 0) return null

    return transcriptToMessages(records)
}
