/**
 * Flat Message Selectors
 *
 * Derived selectors for the flat message-based chat state:
 * - Shared (turn-level) message IDs
 * - Context-aware atoms
 *
 * @module chat/messageSelectors
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {derivedLoadableIdAtom} from "../execution/selectors"

import {messageIdsAtomFamily, messagesByIdAtomFamily} from "./messageAtoms"
import type {ChatMessage} from "./messageTypes"
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
// CONTEXT-AWARE SELECTORS (auto-derive loadableId)
// ============================================================================

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
 * Shared (user/system) message IDs using context-derived loadableId.
 * Equivalent to the old chatTurnIdsWithContext — these are the chat "row IDs".
 */
export const sharedMessageIdsWithContextAtom = atom((get) => {
    const loadableId = get(derivedLoadableIdAtom)
    if (!loadableId) return []
    return get(sharedMessageIdsAtomFamily(loadableId))
})

/**
 * Index of child messages grouped by `parentId:sessionId`.
 *
 * Enables O(1) lookup of assistant/tool message sequences for a given
 * turn+session, replacing O(N) linear scans in turn-level selectors.
 */
export const childMessageIndexWithContextAtom = atom((get) => {
    const ids = get(messageIdsWithContextAtom) as string[]
    const byId = get(messagesByIdWithContextAtom) as Record<string, ChatMessage>

    const index: Record<string, {assistants: ChatMessage[]; tools: ChatMessage[]}> = {}

    for (const mid of ids) {
        const m = byId[mid]
        if (!m || !m.parentId || m.sessionId === SHARED_SESSION_ID) continue

        const key = `${m.parentId}:${m.sessionId}`
        if (!index[key]) index[key] = {assistants: [], tools: []}

        if (m.role === "assistant") {
            index[key].assistants.push(m)
        } else if (m.role === "tool") {
            index[key].tools.push(m)
        }
    }

    return index
})
