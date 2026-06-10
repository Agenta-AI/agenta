/**
 * Switch the playground between chat and completion behavior for a
 * chat-capable app, reshaping data so the switch is lossless.
 *
 * Chat → completion freezes each loaded conversation into its row: the row's
 * `messages` column already holds the conversation (kept in sync by the
 * chat-to-entity adapter), so we split off the trailing assistant reply,
 * write the remaining history back to the column, and surface that reply as
 * the row's latest run result.
 *
 * Completion → chat reshaping (history + latest output → conversation, with a
 * picker when several rows are loaded) lands in PR3. Here we only flip; the
 * load path rebuilds the conversation from the column on next entry.
 *
 * Design doc: docs/design/playground-mode-switch/
 */

import {loadableController} from "@agenta/entities/runnable"
import {atom, type Getter, type Setter} from "jotai"

import {
    playgroundCapabilityModeAtom,
    playgroundModeOverrideAtom,
    type PlaygroundMode,
} from "../atoms/modeOverride"
import {primaryEntityIdAtom} from "../atoms/playground"
import {completeRunAtom} from "../execution/reducer"
import {derivedLoadableIdAtom, isChatModeAtom} from "../execution/selectors"

import {normalizeColumnMessages, splitConversationForCompletion} from "./modeSwitchTransforms"

/**
 * Freeze every loaded conversation into its row, ready for completion runs.
 * The trailing assistant reply becomes the row's result; the rest stays in
 * the `messages` column as plain, editable history.
 */
function freezeConversationsIntoRows(get: Getter, set: Setter, loadableId: string): void {
    const rowIds = get(loadableController.selectors.displayRowIds(loadableId)) as string[]
    const entityId = get(primaryEntityIdAtom)

    for (const rowId of rowIds) {
        const row = get(loadableController.selectors.row(loadableId, rowId)) as {
            data?: Record<string, unknown>
        } | null
        const messages = normalizeColumnMessages(row?.data?.messages)
        const {history, lastOutput} = splitConversationForCompletion(messages)

        // Drop the trailing assistant reply from the column; it becomes the
        // row's output, not part of the frozen history.
        set(loadableController.actions.updateRow, loadableId, rowId, {messages: history})

        if (lastOutput && entityId) {
            set(completeRunAtom, {
                loadableId,
                stepId: rowId,
                sessionId: `sess:${entityId}`,
                result: {output: {response: {data: lastOutput.content}}},
            })
        }
    }
}

/**
 * Flip the playground behavior, reshaping data for the chat → completion
 * direction. No-op when the app is not chat-capable or the target equals the
 * current behavior.
 */
export const switchPlaygroundModeAtom = atom(null, (get, set, target: PlaygroundMode) => {
    if (get(playgroundCapabilityModeAtom) !== "chat") return

    const current: PlaygroundMode = get(isChatModeAtom) ? "chat" : "completion"
    if (target === current) return

    const loadableId = get(derivedLoadableIdAtom)
    if (loadableId && target === "completion") {
        freezeConversationsIntoRows(get, set, loadableId)
    }

    set(playgroundModeOverrideAtom, target)
})
