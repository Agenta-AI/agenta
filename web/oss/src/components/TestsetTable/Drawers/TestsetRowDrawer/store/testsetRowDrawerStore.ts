import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {KeyValuePair} from "@/oss/lib/Types"

interface TestsetRowDrawerState {
    open: boolean
    selectedRowIndex: number | null
    rowData: KeyValuePair | null
    isDirty: boolean
}

// Main drawer state atom
export const testsetRowDrawerAtom = atomWithImmer<TestsetRowDrawerState>({
    open: false,
    selectedRowIndex: null,
    rowData: null,
    isDirty: false,
})

// Action to open the drawer with a specific row
export const openTestsetRowDrawerAtom = atom(
    null,
    (get, set, params: {rowIndex: number; rowData: KeyValuePair}) => {
        set(testsetRowDrawerAtom, (draft) => {
            draft.open = true
            draft.selectedRowIndex = params.rowIndex
            draft.rowData = params.rowData
            draft.isDirty = false
        })
    },
)

// Action to close the drawer
export const closeTestsetRowDrawerAtom = atom(null, (get, set) => {
    set(testsetRowDrawerAtom, (draft) => {
        draft.open = false
    })
})

// Action to update row data in the drawer
export const updateTestsetRowDataAtom = atom(null, (get, set, newData: Partial<KeyValuePair>) => {
    set(testsetRowDrawerAtom, (draft) => {
        if (draft.rowData) {
            draft.rowData = {...draft.rowData, ...newData}
            draft.isDirty = true
        }
    })
})

// Action to reset dirty state
export const resetTestsetRowDirtyAtom = atom(null, (get, set) => {
    set(testsetRowDrawerAtom, (draft) => {
        draft.isDirty = false
    })
})

// Action to fully clear drawer state
export const clearTestsetRowDrawerAtom = atom(null, (_get, set) => {
    set(testsetRowDrawerAtom, {
        open: false,
        selectedRowIndex: null,
        rowData: null,
        isDirty: false,
    })
})
