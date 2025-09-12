import {atom} from "jotai"

import type {ListAppsItem} from "@/oss/lib/Types"

// The shape of the modal state
export interface DeleteAppModalState {
    open: boolean
    appDetails: ListAppsItem | null
    confirmLoading?: boolean
}

// Main atom for the modal state
export const deleteAppModalAtom = atom<DeleteAppModalState>({
    open: false,
    appDetails: null,
    confirmLoading: false,
})

// Selectors
export const isDeleteAppModalOpenAtom = atom((get) => get(deleteAppModalAtom).open)
export const deleteAppModalAppDetailsAtom = atom((get) => get(deleteAppModalAtom).appDetails)

// Actions
export const openDeleteAppModalAtom = atom(null, (get, set, appDetails: ListAppsItem) =>
    set(deleteAppModalAtom, {open: true, appDetails, confirmLoading: false}),
)

export const closeDeleteAppModalAtom = atom(null, (get, set) =>
    set(deleteAppModalAtom, {open: false, appDetails: null, confirmLoading: false}),
)

export const setDeleteAppModalLoadingAtom = atom(null, (get, set, loading: boolean) => {
    const current = get(deleteAppModalAtom)
    set(deleteAppModalAtom, {...current, confirmLoading: loading})
})
