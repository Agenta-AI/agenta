import {atom} from "jotai"

/** Minimal app details needed by the edit modal */
export interface EditAppDetails {
    id: string
    name: string
}

/** Optional callback invoked after a successful rename (e.g. to refetch a list). */
export type EditAppRenamedCallback = (appDetails: EditAppDetails) => void | Promise<void>

// The shape of the modal state
export interface EditAppModalState {
    open: boolean
    appDetails: EditAppDetails | null
    onRenamed?: EditAppRenamedCallback
}

// Main atom for the modal state
export const editAppModalAtom = atom<EditAppModalState>({
    open: false,
    appDetails: null,
    onRenamed: undefined,
})

// Selectors
export const isEditAppModalOpenAtom = atom((get) => get(editAppModalAtom).open)
export const editAppModalAppDetailsAtom = atom((get) => get(editAppModalAtom).appDetails)

// Actions
export const openEditAppModalAtom = atom(
    null,
    (get, set, payload: EditAppDetails & {onRenamed?: EditAppRenamedCallback}) => {
        const {onRenamed, ...appDetails} = payload
        set(editAppModalAtom, {open: true, appDetails, onRenamed})
    },
)

export const closeEditAppModalAtom = atom(null, (get, set) =>
    set(editAppModalAtom, {open: false, appDetails: null, onRenamed: undefined}),
)
