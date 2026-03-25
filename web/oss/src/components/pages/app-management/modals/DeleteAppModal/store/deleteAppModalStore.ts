import {atom} from "jotai"

/** Minimal app details needed by the delete modal */
export interface DeleteAppDetails {
    id: string
    name: string
}

// The shape of the modal state
export interface DeleteAppModalState {
    open: boolean
    appDetails: DeleteAppDetails | null
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
export const openDeleteAppModalAtom = atom(null, (get, set, appDetails: DeleteAppDetails) =>
    set(deleteAppModalAtom, {open: true, appDetails, confirmLoading: false}),
)

export const closeDeleteAppModalAtom = atom(null, (get, set) =>
    set(deleteAppModalAtom, {open: false, appDetails: null, confirmLoading: false}),
)

export const setDeleteAppModalLoadingAtom = atom(null, (get, set, loading: boolean) => {
    const current = get(deleteAppModalAtom)
    set(deleteAppModalAtom, {...current, confirmLoading: loading})
})
