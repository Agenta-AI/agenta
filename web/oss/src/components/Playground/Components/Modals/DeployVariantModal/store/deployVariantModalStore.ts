import {publishMutationAtom} from "@agenta/entities/runnable/deploy"
import {
    workflowMolecule,
    workflowVariantsListDataAtomFamily,
    workflowsListDataAtom,
} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {routerAppIdAtom} from "@/oss/state/app"

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
        const appId = get(routerAppIdAtom)
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
        // Determine the revision to deploy
        const revisionId = state.revisionId || state.parentVariantId
        if (!revisionId) {
            console.debug("[DeployModal] submit:fail", {
                reason: "missing_ids",
                parentVariantId: state.parentVariantId,
                revisionId: state.revisionId,
            })
            return {ok: false, error: "Missing revision to deploy."}
        }

        // Resolve workflow data for application references
        const workflowData = workflowMolecule.get.data(revisionId)

        // Resolve variant name from the variant entity (revision slug is auto-generated hex)
        const workflowId = workflowData?.workflow_id || ""
        const variants = workflowId ? get(workflowVariantsListDataAtomFamily(workflowId)) : []
        const variantEntity = variants.find((v) => v.id === workflowData?.workflow_variant_id)
        const resolvedVariantSlug = variantEntity?.name || variantEntity?.slug || workflowData?.slug

        // Resolve application slug from the workflows list
        const workflows = get(workflowsListDataAtom)
        const workflowEntity = workflows.find((w) => w.id === workflowId)
        const applicationSlug = workflowEntity?.slug || workflowEntity?.name || undefined

        try {
            console.debug("[DeployModal] submit:publish", {
                revisionId,
                env,
                workflowData: workflowData
                    ? {
                          workflow_id: workflowData.workflow_id,
                          workflow_variant_id: workflowData.workflow_variant_id,
                          slug: workflowData.slug,
                          resolvedVariantSlug,
                          applicationSlug,
                      }
                    : null,
            })
            await publish({
                revisionId,
                environmentSlug: env,
                applicationId: workflowId || appId || "",
                workflowVariantId: workflowData?.workflow_variant_id ?? undefined,
                variantSlug: resolvedVariantSlug ?? undefined,
                applicationSlug,
                revisionVersion: workflowData?.version ?? undefined,
                note,
            })
            console.debug("[DeployModal] submit:success", {env})
            return {ok: true, env}
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : "Failed to deploy"
            console.debug("[DeployModal] submit:error", {error: e})
            return {ok: false, error: errorMessage}
        }
    },
)
