import {message} from "@agenta/ui/app-message"
import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {deploymentNoteAtom} from "../../store/deploymentFilterAtoms"

/** Minimal variant info needed for deployment modals */
export interface DeploymentVariantInfo {
    name: string
    version: number | null
}

// Select Deploy Variant Modal State
export interface SelectDeployVariantState {
    open: boolean
    envName: string
    selectedRowKeys: (string | number)[]
}

export const selectDeployVariantStateAtom = atomWithImmer<SelectDeployVariantState>({
    open: false,
    envName: "",
    selectedRowKeys: [],
})

export const openSelectDeployVariantModalAtom = atom(
    null,
    (get, set, payload: {envName: string}) => {
        set(selectDeployVariantStateAtom, (draft) => {
            draft.open = true
            draft.envName = payload.envName
            draft.selectedRowKeys = []
        })
    },
)

export const closeSelectDeployVariantModalAtom = atom(null, (get, set) => {
    set(selectDeployVariantStateAtom, (draft) => {
        draft.open = false
    })
})

export const setSelectedRowKeysAtom = atom(null, (get, set, keys: (string | number)[]) => {
    set(selectDeployVariantStateAtom, (draft) => {
        draft.selectedRowKeys = keys
    })
})

// Deployment Confirmation Modal State
// NOTE: callbacks (onConfirm, onSuccess) are stored in a separate plain atom
// because atomWithImmer freezes state via Immer's produce, which drops functions.
export interface DeploymentConfirmationState {
    open: boolean
    actionType: "deploy" | "revert"
    variant?: DeploymentVariantInfo
    envName: string
    note: string
    successMessage?: string
    okLoading?: boolean
}

interface DeploymentConfirmationCallbacks {
    onConfirm?: (note: string) => Promise<void> | void
    onSuccess?: () => void
}

export const deploymentConfirmationStateAtom = atomWithImmer<DeploymentConfirmationState>({
    open: false,
    actionType: "deploy",
    envName: "",
    note: "",
    okLoading: false,
})

/** Plain atom for callbacks — not frozen by Immer */
const deploymentConfirmationCallbacksAtom = atom<DeploymentConfirmationCallbacks>({})

export const openDeploymentConfirmationModalAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            variant?: DeploymentVariantInfo
            envName: string
            actionType?: "deploy" | "revert"
            onConfirm?: (note: string) => Promise<void> | void
            onSuccess?: () => void
            successMessage?: string
        },
    ) => {
        set(deploymentConfirmationCallbacksAtom, {
            onConfirm: payload.onConfirm,
            onSuccess: payload.onSuccess,
        })
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.open = true
            draft.variant = payload.variant
            draft.envName = payload.envName
            draft.actionType = payload.actionType ?? "deploy"
            draft.successMessage = payload.successMessage
            draft.note = get(deploymentNoteAtom)
        })
    },
)

export const closeDeploymentConfirmationModalAtom = atom(null, (get, set) => {
    set(deploymentConfirmationStateAtom, (draft) => {
        draft.open = false
        draft.okLoading = false
        draft.note = ""
    })
    set(deploymentConfirmationCallbacksAtom, {})
    set(deploymentNoteAtom, "")
})

export const setDeploymentNoteAtom = atom(
    (get) => get(deploymentConfirmationStateAtom).note,
    (get, set, note: string) => {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.note = note
        })
        set(deploymentNoteAtom, note)
    },
)

export const confirmDeploymentAtom = atom(null, async (get, set) => {
    const state = get(deploymentConfirmationStateAtom)
    const callbacks = get(deploymentConfirmationCallbacksAtom)
    if (!callbacks.onConfirm) {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.open = false
        })
        return
    }
    try {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.okLoading = true
        })
        await callbacks.onConfirm(state.note)
        const actionText = state.actionType === "revert" ? "Reverted" : "Deployed"
        const envText = state.envName ? ` in ${state.envName}` : ""
        message.success(state.successMessage || `${actionText}${envText} successfully`)
        callbacks.onSuccess?.()
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.open = false
            draft.note = ""
        })
        set(deploymentConfirmationCallbacksAtom, {})
        set(deploymentNoteAtom, "")
    } finally {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.okLoading = false
        })
    }
})
