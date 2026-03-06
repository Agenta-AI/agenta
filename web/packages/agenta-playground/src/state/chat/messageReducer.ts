/**
 * Flat Message Reducer Actions
 *
 * Write atoms for managing the flat message-based chat state:
 * - Message CRUD (add, update, remove, bulk operations)
 * - Execution lifecycle (start, complete, fail, cancel)
 * - Session operations (clear responses for re-run, duplicate for compare)
 * - Context-aware atoms (auto-inject loadableId)
 *
 * @module chat/messageReducer
 */

import type {SimpleChatMessage} from "@agenta/shared/types"
import {generateId} from "@agenta/shared/utils"
import {atom} from "jotai"

import {derivedLoadableIdAtom} from "../execution/selectors"
import {buildUserMessage} from "../helpers/messageFactory"
import {syncChatMessagesToEntityAtom} from "../helpers/syncChatMessagesToEntity"

import {
    executionByMessageIdAtomFamily,
    messageIdsAtomFamily,
    messagesByIdAtomFamily,
} from "./messageAtoms"
import type {
    AddMessagePayload,
    AddUserMessagePayload,
    ChatMessage,
    ClearSessionResponsesPayload,
    CompleteExecutionPayload,
    DeleteMessagePayload,
    FailExecutionPayload,
    MessageExecution,
    PatchMessagePayload,
    RemoveMessagesPayload,
    StartExecutionPayload,
    TruncateChatPayload,
    UpdateMessagePayload,
} from "./messageTypes"
import {SHARED_SESSION_ID} from "./messageTypes"

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
    return `msg-${generateId()}`
}

// ============================================================================
// MESSAGE CRUD
// ============================================================================

/**
 * Add a message to the conversation.
 *
 * If `afterMessageId` is provided, inserts after that message.
 * Otherwise appends to the end.
 */
export const addMessageAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & AddMessagePayload) => {
        const {loadableId, message, afterMessageId} = payload
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))

        // Ensure message has an ID
        const msg: ChatMessage = message.id ? message : {...message, id: generateMessageId()}
        const msgId = msg.id as string

        // Insert into ordered list
        let nextIds: string[]
        if (afterMessageId) {
            const idx = ids.indexOf(afterMessageId)
            if (idx >= 0) {
                nextIds = [...ids.slice(0, idx + 1), msgId, ...ids.slice(idx + 1)]
            } else {
                nextIds = [...ids, msgId]
            }
        } else {
            nextIds = [...ids, msgId]
        }

        set(messageIdsAtomFamily(loadableId), nextIds)
        set(messagesByIdAtomFamily(loadableId), {...byId, [msgId]: msg})

        // Sync to entity drafts (same pattern as completion mode cell edits)
        set(syncChatMessagesToEntityAtom, loadableId)

        return msgId
    },
)

/**
 * Add multiple messages in order.
 */
export const addMessagesAtom = atom(
    null,
    (get, set, payload: {loadableId: string; messages: ChatMessage[]; afterMessageId?: string}) => {
        const {loadableId, messages, afterMessageId} = payload
        if (messages.length === 0) return

        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = {...get(messagesByIdAtomFamily(loadableId))}

        const newIds: string[] = []
        for (const message of messages) {
            const msg: ChatMessage = message.id ? message : {...message, id: generateMessageId()}
            const msgId = msg.id as string
            byId[msgId] = msg
            newIds.push(msgId)
        }

        let nextIds: string[]
        if (afterMessageId) {
            const idx = ids.indexOf(afterMessageId)
            if (idx >= 0) {
                nextIds = [...ids.slice(0, idx + 1), ...newIds, ...ids.slice(idx + 1)]
            } else {
                nextIds = [...ids, ...newIds]
            }
        } else {
            nextIds = [...ids, ...newIds]
        }

        set(messageIdsAtomFamily(loadableId), nextIds)
        set(messagesByIdAtomFamily(loadableId), byId)

        // Sync to entity drafts
        set(syncChatMessagesToEntityAtom, loadableId)
    },
)

/**
 * Update a message's content (partial merge).
 */
export const updateMessageAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & UpdateMessagePayload) => {
        const {loadableId, messageId, updates} = payload
        const byId = get(messagesByIdAtomFamily(loadableId))
        const existing = byId[messageId]
        if (!existing) return

        set(messagesByIdAtomFamily(loadableId), {
            ...byId,
            [messageId]: {...existing, ...updates, id: existing.id},
        })

        // Sync to entity drafts
        set(syncChatMessagesToEntityAtom, loadableId)
    },
)

/**
 * Remove messages by ID.
 * Also cleans up their execution state.
 */
export const removeMessagesAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & RemoveMessagesPayload) => {
        const {loadableId, messageIds: toRemove} = payload
        if (toRemove.length === 0) return

        const removeSet = new Set(toRemove)

        const ids = get(messageIdsAtomFamily(loadableId))
        set(
            messageIdsAtomFamily(loadableId),
            ids.filter((id) => !removeSet.has(id)),
        )

        const byId = {...get(messagesByIdAtomFamily(loadableId))}
        for (const id of toRemove) {
            delete byId[id]
        }
        set(messagesByIdAtomFamily(loadableId), byId)

        const execMap = {...get(executionByMessageIdAtomFamily(loadableId))}
        let execChanged = false
        for (const id of toRemove) {
            if (id in execMap) {
                delete execMap[id]
                execChanged = true
            }
        }
        if (execChanged) {
            set(executionByMessageIdAtomFamily(loadableId), execMap)
        }

        // Sync to entity drafts
        set(syncChatMessagesToEntityAtom, loadableId)
    },
)

/**
 * Clear all response messages for a session after a given user message.
 *
 * Used for re-runs: removes old assistant/tool responses for the session
 * that were triggered by (or after) the specified user message.
 */
export const clearSessionResponsesAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & ClearSessionResponsesPayload) => {
        const {loadableId, sessionId, afterUserMessageId} = payload
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))

        // Find the position of the user message
        const userIdx = ids.indexOf(afterUserMessageId)
        if (userIdx < 0) return

        // Collect IDs to remove: session-owned messages after (and responding to) this user message
        const toRemove: string[] = []
        for (let i = userIdx + 1; i < ids.length; i++) {
            const msg = byId[ids[i]]
            if (!msg) continue
            if (msg.sessionId === sessionId) {
                toRemove.push(ids[i])
            }
        }

        if (toRemove.length > 0) {
            set(removeMessagesAtom, {loadableId, messageIds: toRemove})
        }
    },
)

/**
 * Truncate conversation after a message (inclusive — the message is kept).
 * Removes all messages after the specified position.
 */
export const truncateAfterMessageAtom = atom(
    null,
    (get, set, payload: {loadableId: string; messageId: string}) => {
        const {loadableId, messageId} = payload
        const ids = get(messageIdsAtomFamily(loadableId))
        const idx = ids.indexOf(messageId)
        if (idx < 0) return

        const toRemove = ids.slice(idx + 1)
        if (toRemove.length === 0) return

        set(removeMessagesAtom, {loadableId, messageIds: toRemove})
        // Note: sync happens inside removeMessagesAtom
    },
)

/**
 * Clear all messages for a loadable.
 */
export const clearAllMessagesAtom = atom(null, (_get, set, payload: {loadableId: string}) => {
    const {loadableId} = payload
    set(messageIdsAtomFamily(loadableId), [])
    set(messagesByIdAtomFamily(loadableId), {})
    set(executionByMessageIdAtomFamily(loadableId), {})
})

// ============================================================================
// EXECUTION LIFECYCLE
// ============================================================================

/**
 * Mark a response message as running.
 */
export const startMessageExecutionAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & StartExecutionPayload) => {
        const {loadableId, messageId, runId} = payload
        const execMap = get(executionByMessageIdAtomFamily(loadableId))

        set(executionByMessageIdAtomFamily(loadableId), {
            ...execMap,
            [messageId]: {
                status: "running",
                runId,
                startedAt: Date.now(),
            },
        })
    },
)

/**
 * Mark a response message as complete.
 */
export const completeMessageExecutionAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & CompleteExecutionPayload) => {
        const {loadableId, messageId, result} = payload
        const execMap = get(executionByMessageIdAtomFamily(loadableId))
        const existing = execMap[messageId]

        set(executionByMessageIdAtomFamily(loadableId), {
            ...execMap,
            [messageId]: {
                ...existing,
                status: "complete",
                output: result.output,
                traceId: result.traceId,
                resultHash: result.resultHash,
                completedAt: Date.now(),
            },
        })
    },
)

/**
 * Mark a response message as failed.
 */
export const failMessageExecutionAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & FailExecutionPayload) => {
        const {loadableId, messageId, error} = payload
        const execMap = get(executionByMessageIdAtomFamily(loadableId))
        const existing = execMap[messageId]

        set(executionByMessageIdAtomFamily(loadableId), {
            ...execMap,
            [messageId]: {
                ...existing,
                status: "error",
                error,
                completedAt: Date.now(),
            },
        })
    },
)

/**
 * Mark a response message as cancelled.
 */
export const cancelMessageExecutionAtom = atom(
    null,
    (get, set, payload: {loadableId: string; messageId: string}) => {
        const {loadableId, messageId} = payload
        const execMap = get(executionByMessageIdAtomFamily(loadableId))
        const existing = execMap[messageId]

        set(executionByMessageIdAtomFamily(loadableId), {
            ...execMap,
            [messageId]: {
                ...existing,
                status: "cancelled",
                completedAt: Date.now(),
            },
        })
    },
)

// ============================================================================
// SESSION OPERATIONS
// ============================================================================

/**
 * Duplicate responses from one session to another.
 *
 * Used when adding a new entity in compare mode — seeds the new session
 * with cloned responses from an existing session.
 */
export const duplicateSessionResponsesAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            loadableId: string
            sourceSessionId: string
            targetSessionId: string
        },
    ) => {
        const {loadableId, sourceSessionId, targetSessionId} = payload
        if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) return

        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))
        const execMap = get(executionByMessageIdAtomFamily(loadableId))

        const newMessages: ChatMessage[] = []
        const newExecEntries: Record<string, MessageExecution> = {}

        for (const id of ids) {
            const msg = byId[id]
            if (!msg || msg.sessionId !== sourceSessionId) continue

            const cloneId = generateMessageId()
            const cloned: ChatMessage = {
                ...structuredClone(msg),
                id: cloneId,
                sessionId: targetSessionId,
            }
            newMessages.push(cloned)

            // Clone execution state if present
            const exec = execMap[id]
            if (exec) {
                newExecEntries[cloneId] = structuredClone(exec)
            }
        }

        if (newMessages.length === 0) return

        // Add cloned messages (append — ordering will be handled by derived turns)
        const updatedById = {...byId}
        const newIds: string[] = []
        for (const msg of newMessages) {
            const msgId = msg.id as string
            updatedById[msgId] = msg
            newIds.push(msgId)
        }

        set(messageIdsAtomFamily(loadableId), [...ids, ...newIds])
        set(messagesByIdAtomFamily(loadableId), updatedById)

        if (Object.keys(newExecEntries).length > 0) {
            set(executionByMessageIdAtomFamily(loadableId), {
                ...execMap,
                ...newExecEntries,
            })
        }
    },
)

// ============================================================================
// DOMAIN-LEVEL ACTIONS (turn-aware operations)
// ============================================================================

/**
 * Add a user message to the conversation.
 * Builds a ChatMessage with SHARED_SESSION_ID and appends via addMessageAtom.
 */
export const addUserMessageAtom = atom(
    null,
    (_get, set, payload: {loadableId: string} & AddUserMessagePayload) => {
        const {loadableId, userMessage, id} = payload
        const msgId = id ?? generateMessageId()
        const userMsg: ChatMessage = {
            ...(userMessage ?? buildUserMessage()),
            id: msgId,
            sessionId: SHARED_SESSION_ID,
        }

        set(addMessageAtom, {loadableId, message: userMsg})
        return msgId
    },
)

/**
 * Truncate chat after a given turn (inclusive — the specified turn and
 * its session-scoped children are kept, everything after is removed).
 */
export const truncateChatAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & TruncateChatPayload) => {
        const {loadableId, afterTurnId} = payload
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))

        const turnIdx = ids.indexOf(afterTurnId)
        if (turnIdx === -1) return

        // Find the next shared message after this one
        let cutIdx = ids.length
        for (let i = turnIdx + 1; i < ids.length; i++) {
            const m = byId[ids[i]]
            if (m && m.sessionId === SHARED_SESSION_ID) {
                cutIdx = i
                break
            }
        }

        const removedIds = ids.slice(cutIdx)
        if (removedIds.length === 0) return

        set(removeMessagesAtom, {loadableId, messageIds: removedIds})
        // Note: sync happens inside removeMessagesAtom
    },
)

/**
 * Resolve a MessageTarget to a flat message ID.
 */
function resolveTargetMessageId(
    ids: string[],
    byId: Record<string, ChatMessage>,
    target: PatchMessagePayload["target"],
): string | null {
    const {turnId, kind, sessionId, toolIndex} = target

    if (kind === "user") return turnId

    if (!sessionId) return null

    if (kind === "assistant") {
        return (
            ids.find((mid) => {
                const m = byId[mid]
                return (
                    m &&
                    m.parentId === turnId &&
                    m.sessionId === sessionId &&
                    m.role === "assistant"
                )
            }) ?? null
        )
    }

    if (kind === "tool") {
        const idx = toolIndex ?? 0
        const toolMsgs = ids.filter((mid) => {
            const m = byId[mid]
            return m && m.parentId === turnId && m.sessionId === sessionId && m.role === "tool"
        })
        return toolMsgs[idx] ?? null
    }

    return null
}

/**
 * Patch a specific message by target (parentId + role + session).
 * Uses updateMessageAtom for updates and removeMessagesAtom for deletes.
 */
export const patchMessageAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & PatchMessagePayload) => {
        const {loadableId, target, updater} = payload
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))

        const msgId = resolveTargetMessageId(ids, byId, target)
        if (!msgId) return

        const current = byId[msgId] as SimpleChatMessage | null
        const updated = updater(current)

        if (updated) {
            set(updateMessageAtom, {
                loadableId,
                messageId: msgId,
                updates: {...updated, id: msgId, sessionId: byId[msgId].sessionId},
            })
        } else {
            set(removeMessagesAtom, {loadableId, messageIds: [msgId]})
        }
    },
)

/**
 * Delete a specific message by target.
 *
 * Removes the targeted message and everything after it in the conversation
 * — later turns are invalid without the deleted context. A fresh blank
 * user message is appended so the user can continue typing.
 */
export const deleteMessageAtom = atom(
    null,
    (get, set, payload: {loadableId: string} & DeleteMessagePayload) => {
        const {loadableId, target} = payload
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))

        const msgId = resolveTargetMessageId(ids, byId, target)
        if (!msgId) return

        const idx = ids.indexOf(msgId)
        if (idx < 0) return

        // Truncate: remove this message and everything after it
        const toRemove = ids.slice(idx)
        set(removeMessagesAtom, {loadableId, messageIds: toRemove})

        // Append a blank user message only when the last remaining message
        // is NOT already a user message. If the tail is a user message (e.g.
        // the user deleted the assistant response below it), that user message
        // is the natural next input — no extra blank needed.
        const remaining = get(messageIdsAtomFamily(loadableId))
        const remainingById = get(messagesByIdAtomFamily(loadableId))
        const last = remainingById[remaining[remaining.length - 1]]
        const tailIsUserMsg = last && last.sessionId === SHARED_SESSION_ID && last.role === "user"

        if (!tailIsUserMsg) {
            set(addMessageAtom, {
                loadableId,
                message: {
                    id: generateMessageId(),
                    role: "user",
                    content: "",
                    sessionId: SHARED_SESSION_ID,
                },
            })
        }
    },
)

// ============================================================================
// CONTEXT-AWARE ACTIONS (auto-inject loadableId from primary node)
// ============================================================================

export const addUserMessageWithContextAtom = atom(
    null,
    (get, set, payload: AddUserMessagePayload) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return null
        return set(addUserMessageAtom, {...payload, loadableId})
    },
)

export const truncateChatWithContextAtom = atom(null, (get, set, payload: TruncateChatPayload) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return
    set(truncateChatAtom, {...payload, loadableId})
})

export const patchMessageWithContextAtom = atom(null, (get, set, payload: PatchMessagePayload) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return
    set(patchMessageAtom, {...payload, loadableId})
})

export const deleteMessageWithContextAtom = atom(
    null,
    (get, set, payload: DeleteMessagePayload) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(deleteMessageAtom, {...payload, loadableId})
    },
)

export const addMessageWithContextAtom = atom(null, (get, set, payload: AddMessagePayload) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return null
    return set(addMessageAtom, {...payload, loadableId})
})

export const addMessagesWithContextAtom = atom(
    null,
    (get, set, payload: {messages: ChatMessage[]; afterMessageId?: string}) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(addMessagesAtom, {...payload, loadableId})
    },
)

export const updateMessageWithContextAtom = atom(
    null,
    (get, set, payload: UpdateMessagePayload) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(updateMessageAtom, {...payload, loadableId})
    },
)

export const removeMessagesWithContextAtom = atom(
    null,
    (get, set, payload: RemoveMessagesPayload) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(removeMessagesAtom, {...payload, loadableId})
    },
)

export const clearSessionResponsesWithContextAtom = atom(
    null,
    (get, set, payload: ClearSessionResponsesPayload) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(clearSessionResponsesAtom, {...payload, loadableId})
    },
)

export const truncateAfterMessageWithContextAtom = atom(
    null,
    (get, set, payload: {messageId: string}) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(truncateAfterMessageAtom, {...payload, loadableId})
    },
)

export const clearAllMessagesWithContextAtom = atom(null, (get, set) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return
    set(clearAllMessagesAtom, {loadableId})
})

export const duplicateSessionResponsesWithContextAtom = atom(
    null,
    (get, set, payload: {sourceRevisionId: string; targetRevisionId: string}) => {
        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return
        set(duplicateSessionResponsesAtom, {
            loadableId,
            sourceSessionId: `sess:${payload.sourceRevisionId}`,
            targetSessionId: `sess:${payload.targetRevisionId}`,
        })
    },
)
