/**
 * Flat Message Atoms
 *
 * Base atoms for the flat message-based chat state.
 * Each loadable instance gets its own state via atomFamily.
 *
 * @module chat/messageAtoms
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {ChatMessage, MessageExecution} from "./messageTypes"

// ============================================================================
// GRANULAR ATOMS (for fine-grained subscriptions)
// ============================================================================

/**
 * Ordered message IDs for a loadable.
 */
export const messageIdsAtomFamily = atomFamily((_loadableId: string) => atom<string[]>([]))

/**
 * Messages by ID for a loadable.
 */
export const messagesByIdAtomFamily = atomFamily((_loadableId: string) =>
    atom<Record<string, ChatMessage>>({}),
)

/**
 * Execution state by message ID for a loadable.
 */
export const executionByMessageIdAtomFamily = atomFamily((_loadableId: string) =>
    atom<Record<string, MessageExecution>>({}),
)

// ============================================================================
// SINGLE-MESSAGE SELECTORS
// ============================================================================

/**
 * Read a single message by loadableId + messageId.
 */
export const messageAtomFamily = atomFamily(
    ({loadableId, messageId}: {loadableId: string; messageId: string}) =>
        atom((get) => {
            const messagesById = get(messagesByIdAtomFamily(loadableId))
            return messagesById[messageId] ?? null
        }),
)

/**
 * Read execution state for a single message.
 */
export const messageExecutionAtomFamily = atomFamily(
    ({loadableId, messageId}: {loadableId: string; messageId: string}) =>
        atom((get) => {
            const executionMap = get(executionByMessageIdAtomFamily(loadableId))
            return executionMap[messageId] ?? null
        }),
)

/**
 * All messages as an ordered array (derived from messageIds + messagesById).
 */
export const orderedMessagesAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const ids = get(messageIdsAtomFamily(loadableId))
        const byId = get(messagesByIdAtomFamily(loadableId))
        const result: ChatMessage[] = []
        for (const id of ids) {
            const msg = byId[id]
            if (msg) result.push(msg)
        }
        return result
    }),
)

/**
 * Message count for a loadable.
 */
export const messageCountAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(messageIdsAtomFamily(loadableId)).length),
)
