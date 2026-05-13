import {atom} from "jotai"

/** Minimal app details needed by the edit modal */
export interface EditAppDetails {
    id: string
    name: string
}

// The shape of the modal state
export interface EditAppModalState {
    open: boolean
    appDetails: EditAppDetails | null
}

// Main atom for the modal state
export const editAppModalAtom = atom<EditAppModalState>({
    open: false,
    appDetails: null,
})

// Selectors
export const isEditAppModalOpenAtom = atom((get) => get(editAppModalAtom).open)
export const editAppModalAppDetailsAtom = atom((get) => get(editAppModalAtom).appDetails)

// Actions
export const openEditAppModalAtom = atom(null, (get, set, appDetails: EditAppDetails) =>
    set(editAppModalAtom, {open: true, appDetails}),
)

export const closeEditAppModalAtom = atom(null, (get, set) =>
    set(editAppModalAtom, {open: false, appDetails: null}),
)
