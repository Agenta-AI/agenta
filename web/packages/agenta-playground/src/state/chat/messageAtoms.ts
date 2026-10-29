/**
 * Flat Message Atoms
 *
 * Base atoms for the flat message-based chat state.
 * Each loadable instance gets its own state via atomFamily.
 *
 * @module chat/messageAtoms
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

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
