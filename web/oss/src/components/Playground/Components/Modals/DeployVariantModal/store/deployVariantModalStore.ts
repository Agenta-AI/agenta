import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {publishMutationAtom} from "@/oss/state/deployment/atoms/publish"

interface DeployVariantModalState {
    open: boolean
    parentVariantId?: string | null
    revisionId?: string | null
    variantName?: string
    revision?: number | string
    mutate?: () => void
}

export const deployVariantModalAtom = atomWithImmer<DeployVariantModalState>({
    open: false,
})

export const openDeployVariantModalAtom = atom(
    null,
    (
        get,
        set,
        params: {
            parentVariantId?: string | null
            revisionId?: string | null
            variantName: string
            revision: number | string
            mutate?: () => void
        },
    ) => {
        console.debug("[DeployModal] open", params)
        set(deployVariantModalAtom, (draft) => {
            draft.open = true
            if ("parentVariantId" in params) draft.parentVariantId = params.parentVariantId ?? null
            if ("revisionId" in params) draft.revisionId = params.revisionId ?? null
            if ("variantName" in params) draft.variantName = params.variantName
            if ("revision" in params) draft.revision = params.revision
            if ("mutate" in params) draft.mutate = params.mutate
        })
    },
)

export const closeDeployVariantModalAtom = atom(null, (get, set) => {
    set(deployVariantModalAtom, (draft) => {
        draft.open = false
    })
})

// Local modal state managed via atoms
export const deploySelectedEnvAtom = atom<string[]>([])
export const deployNoteAtom = atom<string>("")

export const deployResetAtom = atom(null, (get, set) => {
    set(deploySelectedEnvAtom, [])
    set(deployNoteAtom, "")
})

// Async submit action. Optional overrides allow providing ids directly.
// Returns { ok: boolean, env?: string, error?: string }
export const deploySubmitAtom = atom(
    null,
    async (get, set, overrides?: {parentVariantId?: string | null; revisionId?: string | null}) => {
        const baseState = get(deployVariantModalAtom)
        const state = {
            ...baseState,
            parentVariantId: overrides?.parentVariantId ?? baseState.parentVariantId ?? null,
            revisionId: overrides?.revisionId ?? baseState.revisionId ?? null,
        }
        const selectedEnvName = get(deploySelectedEnvAtom)
        const note = get(deployNoteAtom)
        const {mutateAsync: publish} = get(publishMutationAtom)

        // Debug current state before proceeding
        console.debug("[DeployModal] submit:start", {
            state,
            overrides,
            selectedEnvName,
            note,
        })

        const env = selectedEnvName[0]
        if (!env) {
            console.debug("[DeployModal] submit:fail", {reason: "no_env_selected"})
            return {ok: false, error: "No environment selected"}
        }
        if (!state.parentVariantId && !state.revisionId) {
            console.debug("[DeployModal] submit:fail", {
                reason: "missing_ids",
                parentVariantId: state.parentVariantId,
                revisionId: state.revisionId,
            })
            return {ok: false, error: "Missing revision to deploy."}
        }

        console.debug("[DeployModal] submit:overrides", overrides)

        try {
            console.debug("[DeployModal] submit:publish", {
                mode: state.parentVariantId ? "variant" : "revision",
                parentVariantId: state.parentVariantId,
                revisionId: state.revisionId,
                env,
            })
            await publish(
                state.parentVariantId
                    ? {
                          type: "variant" as const,
                          variant_id: state.parentVariantId,
                          environment_name: env,
                          note,
                          revision_id: state.revisionId || undefined,
                      }
                    : {
                          type: "revision" as const,
                          revision_id: state.revisionId as string,
                          environment_ref: env,
                          note,
                      },
            )
            // success; keep state for UI to clear/close
            console.debug("[DeployModal] submit:success", {env})
            return {ok: true, env}
        } catch (e: any) {
            console.debug("[DeployModal] submit:error", {error: e})
            return {ok: false, error: e?.message || "Failed to deploy"}
        }
    },
)
