/**
 * Flat Message Selectors
 *
 * Derived selectors for the flat message-based chat state:
 * - Derived turns (groups flat messages into UI turn objects)
 * - API history builder (strips metadata for API payloads)
 * - Session-filtered views
 * - Context-aware atoms
 *
 * @module chat/messageSelectors
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {derivedLoadableIdAtom} from "../execution/selectors"

import {
    messageIdsAtomFamily,
    messagesByIdAtomFamily,
    executionByMessageIdAtomFamily,
} from "./messageAtoms"
import type {ChatMessage, DerivedTurn, MessageExecution} from "./messageTypes"
import {SHARED_SESSION_ID} from "./messageTypes"

// ============================================================================
// SHARED MESSAGE IDS (turn-level row IDs)
// ============================================================================

/**
 * IDs of shared (user/system) messages only — equivalent to the old chatTurnIds.
 * These are the "row IDs" for chat mode rendering.
 */
export const sharedMessageIdsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))
        return ids.filter((id) => byId[id]?.sessionId === SHARED_SESSION_ID)
    }),
)

// ============================================================================
// DERIVED TURNS (for UI rendering)
// ============================================================================

/**
 * Group flat messages into derived turns for UI rendering.
 *
 * Algorithm:
 * 1. Walk messageIds in order
 * 2. Every shared (user/system) message starts a new turn group
 * 3. Session-owned messages are grouped into the turn of their parentId
 * 4. Session-owned messages without parentId attach to the most recent turn
 *
 * Returns an ordered array of DerivedTurn objects.
 */
export const derivedTurnsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))
        const execMap = get(executionByMessageIdAtomFamily(loadableId))

        return groupMessagesIntoTurns(ids, byId, execMap)
    }),
)

/**
 * Pure function: groups flat messages into derived turns.
 * Exported for testing and reuse.
 */
export function groupMessagesIntoTurns(
    messageIds: string[],
    messagesById: Record<string, ChatMessage>,
    executionByMessageId: Record<string, MessageExecution>,
): DerivedTurn[] {
    const turns: DerivedTurn[] = []
    const turnByUserMsgId = new Map<string, DerivedTurn>()

    for (const msgId of messageIds) {
        const msg = messagesById[msgId]
        if (!msg) continue

        if (msg.sessionId === SHARED_SESSION_ID) {
            // Shared message (user/system) — starts a new turn
            const turn: DerivedTurn = {
                id: msgId,
                userMessage: msg,
                responses: {},
            }
            turns.push(turn)
            turnByUserMsgId.set(msgId, turn)
        } else {
            // Session-owned message (assistant/tool) — attach to parent turn
            const parentTurn = msg.parentId
                ? turnByUserMsgId.get(msg.parentId)
                : turns[turns.length - 1]

            if (!parentTurn) {
                // Orphan response — create a synthetic turn
                const syntheticTurn: DerivedTurn = {
                    id: `orphan-${msgId}`,
                    userMessage: null,
                    responses: {},
                }
                turns.push(syntheticTurn)
                attachResponseToTurn(syntheticTurn, msg, execMap(msgId))
            } else {
                attachResponseToTurn(parentTurn, msg, execMap(msgId))
            }
        }
    }

    return turns

    function execMap(messageId: string): MessageExecution | null {
        return executionByMessageId[messageId] ?? null
    }
}

/**
 * Attach a session-owned message to a turn's responses.
 */
function attachResponseToTurn(
    turn: DerivedTurn,
    msg: ChatMessage,
    execution: MessageExecution | null,
): void {
    const sessionId = msg.sessionId
    if (!turn.responses[sessionId]) {
        turn.responses[sessionId] = {
            assistant: null,
            tools: [],
            execution: null,
        }
    }

    const bucket = turn.responses[sessionId]

    if (msg.role === "assistant") {
        bucket.assistant = msg
        bucket.execution = execution
    } else if (msg.role === "tool") {
        bucket.tools.push(msg)
    } else {
        // Other roles (function, etc.) — treat as tool-like
        bucket.tools.push(msg)
    }
}

// ============================================================================
// API HISTORY BUILDER
// ============================================================================

/**
 * Build API-ready message history for a session.
 *
 * Walks messages in order, includes:
 * - All shared messages (user/system)
 * - Session-owned messages matching the given sessionId
 *
 * Strips `sessionId` and `parentId` — returns pure SimpleChatMessage[].
 */
export const apiHistoryForSessionAtomFamily = atomFamily(
    ({loadableId, sessionId}: {loadableId: string; sessionId: string}) =>
        atom((get) => {
            const ids = get(messageIdsAtomFamily(loadableId))
            const byId = get(messagesByIdAtomFamily(loadableId))

            return buildApiHistory(ids, byId, sessionId)
        }),
)

/**
 * Pure function: build API-ready history for a session.
 * Exported for testing and reuse.
 */
export function buildApiHistory(
    messageIds: string[],
    messagesById: Record<string, ChatMessage>,
    sessionId: string,
): Omit<ChatMessage, "sessionId" | "parentId">[] {
    const history: Omit<ChatMessage, "sessionId" | "parentId">[] = []

    for (const msgId of messageIds) {
        const msg = messagesById[msgId]
        if (!msg) continue

        // Include shared messages and messages owned by this session
        if (msg.sessionId === SHARED_SESSION_ID || msg.sessionId === sessionId) {
            const {sessionId: _s, parentId: _p, ...apiMsg} = msg
            history.push(apiMsg)
        }
    }

    return history
}

/**
 * Build API history up to (but not including) a specific message.
 *
 * Useful for providing context when executing from a specific point.
 */
export const apiHistoryBeforeMessageAtomFamily = atomFamily(
    ({
        loadableId,
        sessionId,
        beforeMessageId,
    }: {
        loadableId: string
        sessionId: string
        beforeMessageId: string
    }) =>
        atom((get) => {
            const ids = get(messageIdsAtomFamily(loadableId))
            const byId = get(messagesByIdAtomFamily(loadableId))

            const cutoffIdx = ids.indexOf(beforeMessageId)
            const limitedIds = cutoffIdx >= 0 ? ids.slice(0, cutoffIdx) : ids

            return buildApiHistory(limitedIds, byId, sessionId)
        }),
)

// ============================================================================
// SESSION-FILTERED VIEWS
// ============================================================================

/**
 * Get all messages for a specific session (shared + session-owned).
 */
export const messagesForSessionAtomFamily = atomFamily(
    ({loadableId, sessionId}: {loadableId: string; sessionId: string}) =>
        atom((get) => {
            const ids = get(messageIdsAtomFamily(loadableId))
            const byId = get(messagesByIdAtomFamily(loadableId))
            const result: ChatMessage[] = []

            for (const id of ids) {
                const msg = byId[id]
                if (!msg) continue
                if (msg.sessionId === SHARED_SESSION_ID || msg.sessionId === sessionId) {
                    result.push(msg)
                }
            }

            return result
        }),
)

/**
 * Get all active session IDs that have at least one response message.
 */
export const activeSessionIdsFromMessagesAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))
        const sessionIds = new Set<string>()

        for (const id of ids) {
            const msg = byId[id]
            if (msg && msg.sessionId !== SHARED_SESSION_ID) {
                sessionIds.add(msg.sessionId)
            }
        }

        return Array.from(sessionIds)
    }),
)

// ============================================================================
// EXECUTION QUERIES
// ============================================================================

/**
 * Check if any response message for a session is currently running.
 */
export const isSessionRunningAtomFamily = atomFamily(
    ({loadableId, sessionId}: {loadableId: string; sessionId: string}) =>
        atom((get) => {
            const ids = get(messageIdsAtomFamily(loadableId))
            const byId = get(messagesByIdAtomFamily(loadableId))
            const execMap = get(executionByMessageIdAtomFamily(loadableId))

            for (const id of ids) {
                const msg = byId[id]
                if (!msg || msg.sessionId !== sessionId) continue
                const exec = execMap[id]
                if (exec?.status === "running") return true
            }

            return false
        }),
)

/**
 * Check if any session has a running execution.
 */
export const isAnySessionRunningAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const execMap = get(executionByMessageIdAtomFamily(loadableId))
        for (const exec of Object.values(execMap)) {
            if (exec.status === "running") return true
        }
        return false
    }),
)

// ============================================================================
// CONTEXT-AWARE SELECTORS (auto-derive loadableId)
// ============================================================================

/**
 * Derived turns using context-derived loadableId.
 */
export const derivedTurnsWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []
    return get(derivedTurnsAtomFamily(loadableId))
})

/**
 * Message IDs using context-derived loadableId.
 */
export const messageIdsWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []
    return get(messageIdsAtomFamily(loadableId))
})

/**
 * Messages by ID using context-derived loadableId.
 */
export const messagesByIdWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return {} as Record<string, ChatMessage>
    return get(messagesByIdAtomFamily(loadableId))
})

/**
 * Execution map using context-derived loadableId.
 */
export const executionByMessageIdWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return {} as Record<string, MessageExecution>
    return get(executionByMessageIdAtomFamily(loadableId))
})

/**
 * Shared (user/system) message IDs using context-derived loadableId.
 * Equivalent to the old chatTurnIdsWithContext — these are the chat "row IDs".
 */
export const sharedMessageIdsWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []
    return get(sharedMessageIdsAtomFamily(loadableId))
})

/**
 * Message count using context-derived loadableId.
 */
export const messageCountWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return 0
    return get(messageIdsAtomFamily(loadableId)).length
})

/**
 * Index of child messages grouped by `parentId:sessionId`.
 *
 * Enables O(1) lookup of assistant/tool messages for a given turn+session,
 * replacing O(N) linear scans in assistantForTurn / toolsForTurn selectors.
 */
export const childMessageIndexWithContextAtom = atom((get) => {
    const ids = get(messageIdsWithContextAtom) as string[]
    const byId = get(messagesByIdWithContextAtom) as Record<string, ChatMessage>

    const index: Record<string, {assistant: ChatMessage | null; tools: ChatMessage[]}> = {}

    for (const mid of ids) {
        const m = byId[mid]
        if (!m || !m.parentId || m.sessionId === SHARED_SESSION_ID) continue

        const key = `${m.parentId}:${m.sessionId}`
        if (!index[key]) index[key] = {assistant: null, tools: []}

        if (m.role === "assistant") {
            index[key].assistant = m
        } else if (m.role === "tool") {
            index[key].tools.push(m)
        }
    }

    return index
})
