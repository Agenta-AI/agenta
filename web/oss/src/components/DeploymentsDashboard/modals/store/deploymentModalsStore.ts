import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {message} from "@/oss/components/AppMessageContext"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {DeploymentRevisions} from "@/oss/lib/Types"

import {deploymentNoteAtom} from "../../atoms"

// Select Deploy Variant Modal State
export interface SelectDeployVariantState {
    open: boolean
    variants: EnhancedVariant[]
    envRevisions?: DeploymentRevisions
    selectedRowKeys: (string | number)[]
}

export const selectDeployVariantStateAtom = atomWithImmer<SelectDeployVariantState>({
    open: false,
    variants: [],
    envRevisions: undefined,
    selectedRowKeys: [],
})

export const openSelectDeployVariantModalAtom = atom(
    null,
    (get, set, payload: {variants: EnhancedVariant[]; envRevisions?: DeploymentRevisions}) => {
        set(selectDeployVariantStateAtom, (draft) => {
            draft.open = true
            draft.variants = payload.variants
            draft.envRevisions = payload.envRevisions
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
export interface DeploymentConfirmationState {
    open: boolean
    actionType: "deploy" | "revert"
    variant?: EnhancedVariant
    envName: string
    note: string
    onConfirm?: (note: string) => Promise<void> | void
    onSuccess?: () => void
    successMessage?: string
    okLoading?: boolean
}

export const deploymentConfirmationStateAtom = atomWithImmer<DeploymentConfirmationState>({
    open: false,
    actionType: "deploy",
    envName: "",
    note: "",
    okLoading: false,
})

export const openDeploymentConfirmationModalAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            variant?: EnhancedVariant
            envName: string
            actionType?: "deploy" | "revert"
            onConfirm?: (note: string) => Promise<void> | void
            onSuccess?: () => void
            successMessage?: string
        },
    ) => {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.open = true
            draft.variant = payload.variant
            draft.envName = payload.envName
            draft.actionType = payload.actionType ?? "deploy"
            draft.onConfirm = payload.onConfirm
            draft.onSuccess = payload.onSuccess
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
    if (!state.onConfirm) {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.open = false
        })
        return
    }
    try {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.okLoading = true
        })
        await state.onConfirm(state.note)
        const actionText = state.actionType === "revert" ? "Reverted" : "Deployed"
        const envText = state.envName ? ` in ${state.envName}` : ""
        message.success(state.successMessage || `${actionText}${envText} successfully`)
        state.onSuccess?.()
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.open = false
            draft.note = ""
        })
        set(deploymentNoteAtom, "")
    } finally {
        set(deploymentConfirmationStateAtom, (draft) => {
            draft.okLoading = false
        })
    }
})
