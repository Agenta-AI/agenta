import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithImmer} from "jotai-immer"

import type {ColumnViewportVisibilityEvent} from "../types"

const DEFAULT_SCOPE = "__default__"
const resolveScopeKey = (scopeId: string | null) => scopeId ?? DEFAULT_SCOPE

type ColumnVisibilityState = Map<string, Map<string, boolean>>
type ColumnVisibilityUserState = Record<string, Record<string, boolean>>

const createScopeMap = () => new Map<string, boolean>()
const EMPTY_SCOPE_MAP = createScopeMap()

const columnVisibilityStateAtom = atomWithImmer<ColumnVisibilityState>(new Map())
const defaultVisibilityAtom = atom(false)

// const visibilityDebugEnabled = process.env.NEXT_PUBLIC_EVAL_RUN_DEBUG === "true"

// const logStateTable = (
//     scopeId: string | null,
//     previous: Record<string, boolean>,
//     next: Record<string, boolean>,
// ) => {
//     if (!visibilityDebugEnabled || typeof window === "undefined") return
//     // const timestamp = new Date().toISOString()
//     // const scopeLabel = scopeId ? `scope:${scopeId}` : "scope:none"
//     const keys = Array.from(new Set([...Object.keys(previous), ...Object.keys(next)])).sort()
//     const rows = keys
//         .map((column) => {
//             const prev = previous[column] ?? false
//             const nextValue = next[column] ?? false
//             if (prev === nextValue) {
//                 return null
//             }
//             return {
//                 column,
//                 prev,
//                 next: nextValue,
//             }
//         })
//         .filter((row): row is {column: string; prev: boolean; next: boolean} => row !== null)
//     if (!rows.length) {
//         return
//     }
//     // try {
//     //     console.groupCollapsed("[infiniteTable][columnVisibility]", `${timestamp} ${scopeLabel}`)
//     //     console.table(rows)
//     //     console.groupEnd()
//     // } catch (error) {
//     //     console.debug("[infiniteTable][columnVisibility] log failed", error)
//     // }
// }

type ColumnViewportVisibilityPayload =
    | ColumnViewportVisibilityEvent
    | ColumnViewportVisibilityEvent[]

export const setColumnViewportVisibilityAtom = atom(
    null,
    (get, set, payload: ColumnViewportVisibilityPayload) => {
        const updates = Array.isArray(payload) ? payload : [payload]
        if (!updates.length) {
            return
        }

        set(columnVisibilityStateAtom, (draft) => {
            updates.forEach((update) => {
                const scopeKey = resolveScopeKey(update.scopeId)
                let scopeMap = draft.get(scopeKey)
                if (!scopeMap) {
                    scopeMap = new Map<string, boolean>()
                    draft.set(scopeKey, scopeMap)
                }
                const previousValue = scopeMap.get(update.columnKey) ?? false
                if (previousValue === update.visible) {
                    return
                }
                scopeMap.set(update.columnKey, update.visible)
            })
        })
    },
)

/**
 * Delete column visibility state from the atom
 * Use when columns are removed from DOM to prevent stale visibility state
 */
export const deleteColumnViewportVisibilityAtom = atom(
    null,
    (
        get,
        set,
        payload:
            | {scopeId: string | null; columnKey: string}
            | {scopeId: string | null; columnKey: string}[],
    ) => {
        const deletions = Array.isArray(payload) ? payload : [payload]
        if (!deletions.length) {
            return
        }

        set(columnVisibilityStateAtom, (draft) => {
            deletions.forEach((deletion) => {
                const scopeKey = resolveScopeKey(deletion.scopeId)
                const scopeMap = draft.get(scopeKey)
                if (scopeMap) {
                    scopeMap.delete(deletion.columnKey)
                }
            })
        })
    },
)

const viewportStateAtomFamily = atomFamily(
    (scopeId: string | null) =>
        atom(
            (get) =>
                get(columnVisibilityStateAtom).get(resolveScopeKey(scopeId)) ?? EMPTY_SCOPE_MAP,
        ),
    (a, b) => resolveScopeKey(a) === resolveScopeKey(b),
)

const columnViewportVisibilityAtomFamily = atomFamily(
    ({scopeId, columnKey}: {scopeId: string | null; columnKey: string}) =>
        selectAtom(
            viewportStateAtomFamily(scopeId),
            // Always default to true (visible) for columns not yet tracked
            // This ensures:
            // 1. Cells render immediately on scope change (e.g., revision switch)
            // 2. Newly expanded column groups show content immediately
            // 3. IntersectionObserver will set to false if outside viewport
            (state) => state.get(columnKey) ?? true,
            (a, b) => a === b,
        ),
    (a, b) =>
        resolveScopeKey(a.scopeId) === resolveScopeKey(b.scopeId) && a.columnKey === b.columnKey,
)

export const getColumnViewportVisibilityAtom = (
    scopeId: string | null,
    columnKey: string | undefined,
) => {
    if (!scopeId || !columnKey) {
        return defaultVisibilityAtom
    }
    return columnViewportVisibilityAtomFamily({scopeId, columnKey})
}

const userVisibilityStateAtom = atomWithImmer<ColumnVisibilityUserState>({})

const userStateAtomFamily = atomFamily(
    (scopeId: string | null) =>
        atom((get) => get(userVisibilityStateAtom)[resolveScopeKey(scopeId)] ?? {}),
    (a, b) => resolveScopeKey(a) === resolveScopeKey(b),
)

export const setColumnUserVisibilityAtom = atom(
    null,
    (
        get,
        set,
        update: {
            scopeId: string | null
            columnKey: string
            visible: boolean
        },
    ) => {
        const scopeKey = resolveScopeKey(update.scopeId)
        const prevState = get(userVisibilityStateAtom)
        const prevScopeEntries = prevState[scopeKey] ?? {}
        const previousValue = prevScopeEntries[update.columnKey] ?? false
        if (previousValue === update.visible) {
            return
        }

        set(userVisibilityStateAtom, (draft) => {
            if (!draft[scopeKey]) {
                draft[scopeKey] = {}
            }
            draft[scopeKey][update.columnKey] = update.visible
        })
    },
)

const columnUserVisibilityAtomFamily = atomFamily(
    ({scopeId, columnKey}: {scopeId: string | null; columnKey: string}) =>
        selectAtom(
            userStateAtomFamily(scopeId),
            (state) => {
                const scopedValue = state[columnKey]
                return scopedValue === undefined ? true : scopedValue
            },
            (a, b) => a === b,
        ),
    (a, b) =>
        resolveScopeKey(a.scopeId) === resolveScopeKey(b.scopeId) && a.columnKey === b.columnKey,
)

export const getColumnUserVisibilityAtom = (
    scopeId: string | null,
    columnKey: string | undefined,
) => {
    if (!scopeId || !columnKey) {
        return defaultVisibilityAtom
    }
    return columnUserVisibilityAtomFamily({scopeId, columnKey})
}

export const getColumnEffectiveVisibilityAtom = (
    scopeId: string | null,
    columnKey: string | undefined,
) => {
    if (!scopeId || !columnKey) {
        return defaultVisibilityAtom
    }
    const userAtom = getColumnUserVisibilityAtom(scopeId, columnKey)
    const viewportAtom = getColumnViewportVisibilityAtom(scopeId, columnKey)
    return atom((get) => get(userAtom) && get(viewportAtom))
}

// const scopeVisibilityMapAtomFamily = atomFamily((scopeId: string | null) =>
//     selectAtom(
//         atom((get) => {
//             const viewportState = get(viewportStateAtomFamily(scopeId))
//             const userState = get(userStateAtomFamily(scopeId))
//             const keys = new Set([...Object.keys(viewportState), ...Object.keys(userState)])
//             const next: Record<string, boolean> = {}
//             keys.forEach((key) => {
//                 const viewportVisible = viewportState[key]
//                 const userVisible = userState[key]
//                 next[key] =
//                     (userVisible === undefined ? true : userVisible) &&
//                     (viewportVisible === undefined ? false : viewportVisible)
//             })
//             return next
//         }),
//         (a, b) => deepEqual(resolveScopeKey(a), resolveScopeKey(b)),
//     ),
// )

// export const getScopeVisibilityMapAtom = (scopeId: string | null) =>

export const scopedColumnVisibilityAtomFamily = atomFamily(
    ({scopeId, columnKey}: {scopeId: string | null; columnKey: string}) =>
        columnViewportVisibilityAtomFamily({scopeId, columnKey}),
    (a, b) =>
        resolveScopeKey(a.scopeId) === resolveScopeKey(b.scopeId) && a.columnKey === b.columnKey,
)

// export const getScopedColumnVisibilityAtom = (scopeId: string | null, columnKey?: string) => {
//     if (!columnKey) {
//         return defaultVisibilityAtom
//     }
//     return selectAtom(
//         scopeVisibilityMapAtomFamily(scopeId),
//         (state) => {
//             const explicit = state[columnKey]
//             console.log("scopeVisibilityMapAtomFamily", state)
//             if (typeof explicit === "boolean") {
//                 return explicit
//             }
//             return true
//         },
//         (a, b) => a === b,
//     )
// }
