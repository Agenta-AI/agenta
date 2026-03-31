import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

// Drawer state is intentionally minimal; data is derived in the wrapper

export interface DeploymentsDrawerState {
    open: boolean
    initialWidth: number
    revisionId: string
    deploymentRevisionId?: string
    envName?: string
    mode: "deployment" | "variant"
}

export const deploymentsDrawerStateAtom = atomWithImmer<DeploymentsDrawerState>({
    open: false,
    revisionId: "",
    deploymentRevisionId: "",
    envName: "",
    initialWidth: 720,
    mode: "deployment",
})

export const openDeploymentsDrawerAtom = atom(
    null,
    (
        get,
        set,
        payload?: {
            initialWidth?: number
            revisionId?: string
            deploymentRevisionId?: string
            envName?: string
            mode?: "deployment" | "variant"
        },
    ) => {
        set(deploymentsDrawerStateAtom, (draft) => {
            draft.open = true
            draft.initialWidth = payload?.initialWidth ?? draft.initialWidth
            draft.revisionId = payload?.revisionId ?? draft.revisionId
            draft.deploymentRevisionId = payload?.deploymentRevisionId ?? draft.deploymentRevisionId
            draft.envName = payload?.envName ?? draft.envName
            draft.mode = payload?.mode ?? "deployment"
        })
    },
)

export const closeDeploymentsDrawerAtom = atom(null, (get, set) => {
    set(deploymentsDrawerStateAtom, (draft) => {
        draft.open = false
        draft.revisionId = ""
        draft.deploymentRevisionId = ""
        draft.envName = ""
        draft.mode = "deployment"
    })
})
