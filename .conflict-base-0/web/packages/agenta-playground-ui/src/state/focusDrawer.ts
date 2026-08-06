import {atom} from "jotai"

export interface PlaygroundFocusDrawerState {
    isOpen: boolean
    /** The ID of the input row (test case) */
    rowId: string | null
    /** The ID of the variant (app revision) - optional */
    entityId?: string | null
}

const initialState: PlaygroundFocusDrawerState = {
    isOpen: false,
    rowId: null,
    entityId: null,
}

export const playgroundFocusDrawerAtom = atom<PlaygroundFocusDrawerState>(initialState)

export const isplaygroundFocusDrawerOpenAtom = atom(
    (get) => get(playgroundFocusDrawerAtom).isOpen,
    (_get, set, isOpen: boolean) => {
        set(playgroundFocusDrawerAtom, (prev) => ({...prev, isOpen}))
    },
)

export const openPlaygroundFocusDrawerAtom = atom(
    null,
    (_get, set, payload: {rowId: string; entityId?: string | null}) => {
        set(playgroundFocusDrawerAtom, {
            isOpen: true,
            rowId: payload.rowId,
            entityId: payload.entityId,
        })
    },
)

export const closePlaygroundFocusDrawerAtom = atom(null, (_get, set) => {
    set(playgroundFocusDrawerAtom, (prev) => ({...prev, isOpen: false}))
})

export const resetPlaygroundFocusDrawerAtom = atom(null, (_get, set) => {
    set(playgroundFocusDrawerAtom, initialState)
})
