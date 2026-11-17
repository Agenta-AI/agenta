/**
 * Column edits of a revision, staged until the commit.
 *
 * A column edit has two parts. The pending column operations say what the commit sends; they
 * apply to every saved row, also rows the page has not loaded. The drafts of edited and new
 * rows hold the values the user sees and the commit sends in full, so the edit is made in
 * them at once. A row without a draft gets the pending operations when it is read (see
 * `testcaseEntityAtomFamily`).
 *
 * `revisionMolecule.tableReducers.addColumn`, `removeColumn` and `renameColumn` are these atoms.
 * Every key is the current name of a column; the caller checks that a new name is free.
 */

import {atom, type Getter, type Setter} from "jotai"

import {
    deletedEntityIdsAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
    testcaseIdsAtom,
} from "../../testcase/state/store"

import {addColumnReducer, removeColumnReducer, renameColumnReducer} from "./revisionTableState"

/** Rewrites the data of every row draft. `rewrite` returns null to leave a row as it is. */
const rewriteDrafts = (
    get: Getter,
    set: Setter,
    rewrite: (data: Record<string, unknown>) => Record<string, unknown> | null,
) => {
    const ids = new Set([
        ...get(testcaseIdsAtom),
        ...get(newEntityIdsAtom),
        ...get(deletedEntityIdsAtom),
    ])
    for (const id of ids) {
        const draft = get(testcaseDraftAtomFamily(id))
        if (!draft?.data) continue
        const data = rewrite(draft.data)
        if (data) set(testcaseDraftAtomFamily(id), {...draft, data})
    }
}

/** Adds a column. Rows get an empty value for it when they are read. */
export const addColumnEditAtom = atom(
    null,
    (_get, set, params: {revisionId: string; columnKey: string}) => {
        set(addColumnReducer, params)
    },
)

/** Removes a column and its values. */
export const removeColumnEditAtom = atom(
    null,
    (get, set, params: {revisionId: string; columnKey: string}) => {
        const {columnKey} = params
        rewriteDrafts(get, set, (data) => {
            if (!Object.hasOwn(data, columnKey)) return null
            const next = {...data}
            delete next[columnKey]
            return next
        })
        set(removeColumnReducer, params)
    },
)

/** Renames a column. The values keep their place in each row. */
export const renameColumnEditAtom = atom(
    null,
    (get, set, params: {revisionId: string; oldKey: string; newKey: string}) => {
        const {oldKey, newKey} = params
        if (oldKey === newKey) return
        rewriteDrafts(get, set, (data) => {
            if (!Object.hasOwn(data, oldKey)) return null
            return Object.fromEntries(
                Object.entries(data).map(([key, value]) => [key === oldKey ? newKey : key, value]),
            )
        })
        set(renameColumnReducer, params)
    },
)
