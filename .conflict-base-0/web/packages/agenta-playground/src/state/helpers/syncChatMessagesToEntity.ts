/**
 * Sync Chat Messages to Entity Drafts
 *
 * Bridges the chat atom system back to the testcase entity layer.
 * When chat messages are mutated (add / update / remove / patch / truncate),
 * this atom serializes the current message list and writes it to the
 * entity draft's `data.messages` via `testcaseMolecule.actions.update`.
 *
 * This follows the same real-time pattern that completion mode uses:
 *   completion: setTestcaseCellValueAtom → testcaseMolecule.actions.update(id, {data: {col: val}})
 *   chat:       syncChatMessagesToEntityAtom → testcaseMolecule.actions.update(id, {data: {messages}})
 *
 * @module helpers/syncChatMessagesToEntity
 */

import {testcaseMolecule} from "@agenta/entities/testcase"
import {atom} from "jotai"

import {messageIdsAtomFamily, messagesByIdAtomFamily} from "../chat/messageAtoms"
import type {ChatMessage} from "../chat/messageTypes"
import {SHARED_SESSION_ID} from "../chat/messageTypes"

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Converts a ChatMessage back to the testset row format.
 * Strips internal metadata (sessionId, parentId, id) and keeps
 * only the fields that belong in a testset message.
 */
function serializeMessage(msg: ChatMessage): Record<string, unknown> {
    const serialized: Record<string, unknown> = {
        role: msg.role,
        content: msg.content,
    }

    if (msg.name) serialized.name = msg.name
    if (msg.tool_call_id) serialized.tool_call_id = msg.tool_call_id
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        serialized.tool_calls = msg.tool_calls
    }

    return serialized
}

/**
 * Collects the canonical message list from the flat chat atoms.
 *
 * Rules:
 * - Include all shared (user/system) messages
 * - For per-session messages (assistant/tool), take only the first session's
 *   responses at each turn (avoids duplicating across compare-mode sessions)
 * - Skip the trailing blank user message (the input placeholder)
 * - Preserve conversation order from `messageIds`
 */
function collectSerializableMessages(
    ids: string[],
    byId: Record<string, ChatMessage>,
): Record<string, unknown>[] {
    if (ids.length === 0) return []

    // Determine which session to use for per-session messages.
    // Pick the first non-shared session encountered.
    let canonicalSession: string | null = null
    for (const id of ids) {
        const msg = byId[id]
        if (msg && msg.sessionId !== SHARED_SESSION_ID) {
            canonicalSession = msg.sessionId
            break
        }
    }

    const result: Record<string, unknown>[] = []

    for (let i = 0; i < ids.length; i++) {
        const msg = byId[ids[i]]
        if (!msg) continue

        const isShared = msg.sessionId === SHARED_SESSION_ID

        // Skip trailing blank user message (the input placeholder).
        // It's always the last shared message with empty content.
        if (isShared && msg.role === "user" && i === ids.length - 1) {
            const content = msg.content
            const isEmpty =
                content === "" ||
                content === null ||
                content === undefined ||
                (Array.isArray(content) && content.length === 0)
            if (isEmpty) continue
        }

        if (isShared) {
            // User/system messages → always include
            result.push(serializeMessage(msg))
        } else if (msg.sessionId === canonicalSession) {
            // Per-session messages → only from the canonical session
            result.push(serializeMessage(msg))
        }
        // Messages from other sessions are skipped (compare-mode duplicates)
    }

    return result
}

// ============================================================================
// SYNC ATOM
// ============================================================================

/**
 * Write atom that serializes the current chat messages and writes them
 * to the testcase entity draft(s) via testcaseMolecule.actions.update.
 *
 * Should be called after every message mutation that changes content.
 */
export const syncChatMessagesToEntityAtom = atom(null, (get, set, loadableId: string) => {
    const ids = get(messageIdsAtomFamily(loadableId))
    const byId = get(messagesByIdAtomFamily(loadableId))

    // Serialize messages to testset format
    const serializedMessages = collectSerializableMessages(ids, byId)

    // Get the active row IDs and write messages to each
    const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)

    for (const rowId of displayRowIds) {
        set(testcaseMolecule.actions.update, rowId, {
            data: {messages: serializedMessages},
        })
    }
})
