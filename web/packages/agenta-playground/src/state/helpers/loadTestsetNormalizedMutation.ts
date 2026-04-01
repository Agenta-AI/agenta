import {loadableController} from "@agenta/entities/runnable"
import {atom} from "jotai"

import {clearAllMessagesAtom} from "../chat/messageReducer"
import {derivedLoadableIdAtom, isChatModeAtom} from "../execution/selectors"

import {extractAndLoadChatMessagesAtom} from "./extractAndLoadChatMessages"
import {normalizeTestcaseRowsForLoad} from "./testcaseRowNormalization"

const MESSAGE_FIELD_KEYS = new Set([
    "messages",
    "correct_answer",
    "expected_output",
    "ground_truth",
    "target",
    "label",
])

/**
 * Load testset rows into normalized package state.
 * - Completion mode: rows only.
 * - Chat mode: rows + turn history generated from `messages` fields.
 */
export const loadTestsetNormalizedMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            testsetData: Record<string, unknown>[]
            isChatVariant?: boolean
            regenerateVariableIds?: boolean
        },
    ) => {
        const {testsetData = [], isChatVariant = get(isChatModeAtom) ?? false} = params ?? {}
        if (!Array.isArray(testsetData) || testsetData.length === 0) return

        const loadableId = get(derivedLoadableIdAtom)
        if (!loadableId) return

        const dataset = Array.isArray(testsetData) ? testsetData : []
        const normalizedRows = normalizeTestcaseRowsForLoad(dataset)
        const flatRows = normalizedRows.map(({id, data}) => (id ? {id, ...data} : {...data}))

        if (isChatVariant) {
            set(clearAllMessagesAtom, {loadableId})

            const rowData = (normalizedRows[0]?.data || {}) as Record<string, unknown>
            const keys = Object.keys(rowData).filter((k) => !MESSAGE_FIELD_KEYS.has(k))

            const updateData: Record<string, unknown> = {}
            for (const key of keys) {
                const raw = rowData[key]
                if (raw === undefined) continue
                updateData[key] = raw
            }

            const existingRowIds = get(loadableController.selectors.displayRowIds(loadableId))
            if (existingRowIds.length > 0) {
                set(loadableController.actions.updateRow, loadableId, existingRowIds[0], updateData)
            } else {
                set(loadableController.actions.addRow, loadableId, updateData)
            }
        } else {
            set(loadableController.actions.clearRows, loadableId)

            for (const row of normalizedRows) {
                const keys = Object.keys(row.data).filter((k) => !MESSAGE_FIELD_KEYS.has(k))
                const data: Record<string, unknown> = {}

                for (const key of keys) {
                    const raw = row.data[key]
                    if (raw === undefined) continue
                    data[key] = raw
                }

                set(loadableController.actions.addRow, loadableId, data)
            }
        }

        if (!isChatVariant) return

        // Delegate to the shared chat message extraction helper
        set(extractAndLoadChatMessagesAtom, {
            loadableId,
            testcaseRows: flatRows,
            skipBlankMessage: true,
        })
    },
)
