import {atom} from "jotai"

/** Minimal app details needed by the delete modal */
export interface DeleteAppDetails {
    id: string
    name: string
}

type DeleteAppArchivedCallback = (appDetails: DeleteAppDetails[]) => void | Promise<void>

export type OpenDeleteAppModalPayload =
    | (DeleteAppDetails & {onArchived?: DeleteAppArchivedCallback})
    | {apps: DeleteAppDetails[]; onArchived?: DeleteAppArchivedCallback}

// The shape of the modal state
export interface DeleteAppModalState {
    open: boolean
    appDetails: DeleteAppDetails[]
    confirmLoading?: boolean
    onArchived?: DeleteAppArchivedCallback
}

// Main atom for the modal state
export const deleteAppModalAtom = atom<DeleteAppModalState>({
    open: false,
    appDetails: [],
    confirmLoading: false,
    onArchived: undefined,
})

// Selectors
export const isDeleteAppModalOpenAtom = atom((get) => get(deleteAppModalAtom).open)
export const deleteAppModalAppDetailsAtom = atom((get) => get(deleteAppModalAtom).appDetails)

// Actions
export const openDeleteAppModalAtom = atom(null, (get, set, payload: OpenDeleteAppModalPayload) => {
    const {onArchived} = payload
    const appDetails = "apps" in payload ? payload.apps : [{id: payload.id, name: payload.name}]
    set(deleteAppModalAtom, {open: true, appDetails, confirmLoading: false, onArchived})
})

export const closeDeleteAppModalAtom = atom(null, (get, set) =>
    set(deleteAppModalAtom, {
        open: false,
        appDetails: [],
        confirmLoading: false,
        onArchived: undefined,
    }),
)

export const setDeleteAppModalLoadingAtom = atom(null, (get, set, loading: boolean) => {
    const current = get(deleteAppModalAtom)
    set(deleteAppModalAtom, {...current, confirmLoading: loading})
})
