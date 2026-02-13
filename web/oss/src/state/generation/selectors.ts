// Normalized generation selectors
// Narrow, composable selectors for normalized generation state
import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

// import {generationRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"

import {
    chatSessionsByIdAtom,
    chatTurnsByIdAtom,
    inputRowsByIdComputedAtom,
    rowIdIndexAtom,
    type ChatTurn,
    type InputRow,
} from "./entities"

// Computed map merging base rows and synthesized cache for visible ids
// Computed map merging base rows and synthesized cache for visible ids

// Collections
// Keep this a pure read to avoid write-on-read render loops

// Entity readers (stable projections)
export const inputRowAtomFamily = atomFamily((rowId: string) =>
    selectAtom(inputRowsByIdComputedAtom, (m) => m[rowId] || null, deepEqual),
)

export const chatSessionAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(
        chatSessionsByIdAtom,
        (m) => m[sessionId] || null,
        (a, b) => a === b,
    ),
)

export const chatTurnAtomFamily = atomFamily((turnId: string) =>
    selectAtom(
        chatTurnsByIdAtom,
        (m) => m[turnId] || null,
        (a, b) => a === b,
    ),
)

// Compat: Get chat turn ids for a row via index
export const rowChatTurnIdsAtomFamily = atomFamily((rowId: string) =>
    selectAtom(
        rowIdIndexAtom,
        (idx) => idx[rowId]?.chatTurnIds || [],
        (a, b) => a === b,
    ),
)

// Compat: Get chat turn for a row and turn id (validates membership in index)
export const rowChatTurnAtomFamily = atomFamily((p: {rowId: string; turnId: string}) =>
    atom((get) => {
        const ids = get(rowChatTurnIdsAtomFamily(p.rowId)) as string[]
        if (!ids.includes(p.turnId)) return null
        return get(chatTurnAtomFamily(p.turnId)) as ChatTurn | null
    }),
)

// Row-scoped variables for a revision
export const rowVariablesAtomFamily = atomFamily((p: {rowId: string; revisionId: string}) =>
    atom((get) => {
        const row = get(inputRowAtomFamily(p.rowId)) as InputRow | null
        return row?.variables ?? []
    }),
)

// Row-scoped responses for a revision
export const rowResponsesAtomFamily = atomFamily((p: {rowId: string; revisionId: string}) =>
    atom((get) => {
        const row = get(inputRowAtomFamily(p.rowId)) as InputRow | null
        return row?.responsesByRevision?.[p.revisionId] || []
    }),
)

// Assistant message for a revision at a turn (chat)
export const assistantMessageAtomFamily = atomFamily((p: {turnId: string; revisionId: string}) =>
    atom((get) => {
        const turn = get(chatTurnAtomFamily(p.turnId)) as ChatTurn | null
        return turn?.assistantMessageByRevision?.[p.revisionId] ?? null
    }),
)

// Lightweight compatibility selectors (to be used for incremental migration)
// Note: not wired to any component yet; these mirror common read patterns.

// Get minimal display data for a row variables panel
export const rowVariablesForDisplayAtomFamily = atomFamily(
    (p: {rowId: string; revisionId: string}) =>
        selectAtom(
            // Use stable empty object to avoid identity thrash
            atom((get) => get(rowVariablesAtomFamily(p)) || EMPTY_OBJECT),
            (vars) => vars,
            (a, b) => {
                // shallow compare keys + primitive values
                const aKeys = Object.keys(a || {})
                const bKeys = Object.keys(b || {})
                if (aKeys.length !== bKeys.length) return false
                for (const k of aKeys) {
                    if ((a as Record<string, any>)[k] !== (b as Record<string, any>)[k])
                        return false
                }
                return true
            },
        ),
)

// Get minimal display data for a row responses panel
export const rowResponsesForDisplayAtomFamily = atomFamily(
    (p: {rowId: string; revisionId: string}) =>
        selectAtom(
            // Use stable empty array to avoid identity thrash
            atom((get) => get(rowResponsesAtomFamily(p)) || EMPTY_ARRAY),
            (arr) => arr,
            (a, b) => a === b,
        ),
)

// Stable empty containers to prevent re-render loops on missing data
const EMPTY_ARRAY: any[] = []
const EMPTY_OBJECT: Record<string, any> = {}
