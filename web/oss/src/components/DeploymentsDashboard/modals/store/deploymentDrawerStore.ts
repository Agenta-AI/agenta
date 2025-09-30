import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

// Drawer state is intentionally minimal; data is derived in the wrapper

export interface DeploymentsDrawerState {
    open: boolean
    initialWidth: number
    revisionId: string
}

export const deploymentsDrawerStateAtom = atomWithImmer<DeploymentsDrawerState>({
    open: false,
    revisionId: "",
    initialWidth: 720,
})

export const openDeploymentsDrawerAtom = atom(
    null,
    (
        get,
        set,
        payload?: {
            initialWidth?: number
            revisionId?: string
        },
    ) => {
        set(deploymentsDrawerStateAtom, (draft) => {
            draft.open = true
            if (payload?.initialWidth) draft.initialWidth = payload.initialWidth
            if (payload?.revisionId) draft.revisionId = payload.revisionId
        })
    },
)

export const closeDeploymentsDrawerAtom = atom(null, (get, set) => {
    set(deploymentsDrawerStateAtom, (draft) => {
        draft.open = false
    })
})
