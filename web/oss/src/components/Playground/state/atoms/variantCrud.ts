import {variantsListWithDraftsAtomFamily} from "@agenta/entities/legacyAppRevision"
import {getAllMetadata} from "@agenta/entities/legacyAppRevision"
import {isLocalDraftId} from "@agenta/entities/shared"
import {message} from "@agenta/ui/app-message"
import {produce} from "immer"
import {atom} from "jotai"
import {getDefaultStore} from "jotai"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {deleteSingleVariantRevision} from "@/oss/services/playground/api"
import {currentAppContextAtom, selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {duplicateChatHistoryForRevision} from "@/oss/state/generation/utils"
import {transformedPromptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {
    discardRevisionDraftAtom,
    moleculeBackedPromptsAtomFamily,
    moleculeBackedVariantAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"

import {VariantAPI} from "../../services/api"
import type {
    AddVariantParams,
    SaveVariantParams,
    DeleteVariantParams,
    VariantCrudResult,
    EnhancedVariant,
} from "../types"

import {selectedVariantsAtom} from "./core"
import {parametersOverrideAtomFamily} from "./parametersOverride"
import {
    invalidatePlaygroundQueriesAtom,
    waitForNewRevisionAfterMutationAtom,
    waitForRevisionRemovalAtom,
} from "./queries"
import {revisionListAtom} from "./variants"

// Add variant mutation atom
export const addVariantMutationAtom = atom(
    null,
    async (get, set, params: AddVariantParams): Promise<VariantCrudResult> => {
        let _baseSnapshot: any | null = null

        try {
            // Prefer an explicit revisionId if provided; otherwise derive it from the selected base variant name
            let revisionId: string | undefined = (params as any)?.revisionId

            // Map modal parameters to what we need
            const variantName = params.newVariantName

            // Resolve the baseline revision:
            // 1) If revisionId provided, get directly from molecule (includes draft state).
            // 2) Otherwise, derive it from the newest revision matching baseVariantName.
            let currentBaseRevision = revisionId
                ? get(moleculeBackedVariantAtomFamily(revisionId))
                : null

            if (!currentBaseRevision) {
                const baseName = (params.baseVariantName || "").trim()
                if (!revisionId && baseName) {
                    const revisions = (get(revisionListAtom) || []) as any[]
                    const matching = revisions.filter((r) => {
                        const name = (r?.variantName ?? r?.name ?? "").trim()
                        return name.toLowerCase() === baseName.toLowerCase()
                    })
                    if (matching.length > 0) {
                        // Pick newest by updatedAtTimestamp/createdAtTimestamp, fallback to numeric revision
                        currentBaseRevision = matching.reduce((acc: any, r: any) => {
                            if (!acc) return r
                            const aTs = acc?.updatedAtTimestamp ?? acc?.createdAtTimestamp ?? 0
                            const rTs = r?.updatedAtTimestamp ?? r?.createdAtTimestamp ?? 0
                            if (aTs !== rTs) return rTs > aTs ? r : acc
                            const aRev = Number(acc?.revision) || 0
                            const rRev = Number(r?.revision) || 0
                            return rRev > aRev ? r : acc
                        }, null as any)
                    }
                }

                if (!currentBaseRevision) {
                    throw new Error(
                        revisionId
                            ? `Revision "${revisionId}" not found in playground state`
                            : `Base variant "${params.baseVariantName}" not found or has no revisions loaded in playground state`,
                    )
                }
            }

            // Build ag_config from molecule-backed prompts + baseline non-prompt params
            const prompts = get(moleculeBackedPromptsAtomFamily(currentBaseRevision.id))
            const variantForTransform = {
                ...(currentBaseRevision as any),
                prompts,
            }
            const agConfig =
                transformToRequestBody({
                    variant: variantForTransform as any,
                    allMetadata: getAllMetadata(),
                    appType: (get as any)(currentAppContextAtom)?.appType || undefined,
                })?.ag_config ?? null

            // Resolve baseId robustly:
            // 1. For local drafts, use stored _baseId (preserves original source's baseId)
            // 2. Fall back to adapted revision.baseId
            // 3. Fall back to parent variant lookup
            const localDraftBaseId = isLocalDraftId(currentBaseRevision.id)
                ? (currentBaseRevision as any)._baseId
                : null

            // For local drafts, use stored _sourceVariantId to look up parent variant
            const resolvedVariantIdForLookup = isLocalDraftId(currentBaseRevision.id)
                ? ((currentBaseRevision as any)._sourceVariantId ?? currentBaseRevision.variantId)
                : currentBaseRevision.variantId

            const parentBaseId =
                localDraftBaseId ||
                (() => {
                    try {
                        const appId = get(selectedAppIdAtom)
                        if (!appId) return undefined
                        const parents =
                            get(variantsListWithDraftsAtomFamily(appId))?.data ?? ([] as any[])
                        const pv = parents.find((p: any) => p.id === resolvedVariantIdForLookup)
                        return pv?.baseId
                    } catch {
                        return undefined
                    }
                })()
            const resolvedBaseId = currentBaseRevision.baseId || parentBaseId
            if (!resolvedBaseId) {
                throw new Error(
                    `Missing baseId for revision ${currentBaseRevision.id}; cannot create variant`,
                )
            }

            // Create a new variant from the base without touching the base on server
            const createVariantResponse = await VariantAPI.createVariantFromBase({
                baseId: resolvedBaseId,
                newVariantName: variantName,
                newConfigName: variantName, // Use same name for config
                parameters: agConfig || {},
                commitMessage: params.note,
            })

            // Approach 2: Atom Effect/Listener System
            // Queue an action to run when revisionListAtom actually updates with new data
            const newVariantId =
                createVariantResponse?.variant_id || createVariantResponse?.variantId

            // Invalidate queries to trigger revalidation
            await set(invalidatePlaygroundQueriesAtom)

            // Wait for the new revision to appear using focused waiter
            const {newestRevisionId} = await set(waitForNewRevisionAfterMutationAtom, {
                variantId: newVariantId,
                prevRevisionId: null,
            })

            if (newestRevisionId) {
                const currentDisplayedVariants = get(selectedVariantsAtom)
                let updatedVariants: string[]

                if (params.callback) {
                    const mockState = {
                        selected: [...currentDisplayedVariants],
                        variants: [...currentDisplayedVariants],
                    }
                    // Execute the callback with the new revision object stub
                    params.callback({id: newestRevisionId} as any, mockState as any)
                    updatedVariants = mockState.selected
                } else {
                    updatedVariants = [newestRevisionId]
                }

                duplicateChatHistoryForRevision({
                    get,
                    set,
                    sourceRevisionId: (currentBaseRevision as any)?.id,
                    targetRevisionId: newestRevisionId,
                    displayedVariantsAfterSwap: updatedVariants,
                })

                // Update atom directly for immediate reactivity, then sync to URL
                set(selectedVariantsAtom, updatedVariants)
                void writePlaygroundSelectionToQuery(updatedVariants)

                // Clear draft state for the revision used to create the new variant
                // Use revisionId (the local draft ID passed to the mutation) for cleanup
                try {
                    const revisionIdForClear = revisionId || (currentBaseRevision as any)?.id
                    if (revisionIdForClear) {
                        set(discardRevisionDraftAtom, revisionIdForClear)
                        set(parametersOverrideAtomFamily(revisionIdForClear), null)
                    }
                } catch {}

                return {
                    success: true,
                    variant: {
                        ...createVariantResponse,
                        // Include the revision ID we waited for so the modal can use it
                        id: newestRevisionId,
                    } as any,
                    message: `Variant "${variantName}" created successfully`,
                }
            }

            return {
                success: true,
                variant: createVariantResponse,
                message: `Variant "${variantName}" created; awaiting revalidation`,
            }
        } catch (error) {
            // If something went wrong, no special rollback needed for base revision snapshot.

            if (process.env.NODE_ENV === "development") {
                console.error("❌ [addVariantMutation] Failed to create variant:", error)
            }

            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to create variant",
            }
        }
    },
)

// Save variant mutation atom
export const saveVariantMutationAtom = atom(
    null,
    async (get, set, params: SaveVariantParams): Promise<VariantCrudResult> => {
        try {
            const {variantId, config, variantName} = params

            // Get current baseline revision by ID using molecule-backed selector (includes draft state)
            const currentVariant = get(moleculeBackedVariantAtomFamily(variantId)) as
                | EnhancedVariant
                | undefined

            if (!currentVariant) {
                throw new Error(`Variant ${variantId} not found in playground state`)
            }

            // Create optimistic update (not applied locally in simplified model)
            const _optimisticVariant = produce(currentVariant, (draft) => {
                if (config) {
                    draft.parameters = {...draft.parameters, ...config}
                }
                if (variantName) {
                    draft.variantName = variantName
                }
                // Intentionally avoid touching updatedAt/updatedAtTimestamp to prevent
                // the drawer "Date modified" flicker during the in-flight request.
                // The server revalidation will provide the authoritative timestamp.
            })

            // Prefer explicit JSON editor override when committing parameters directly
            const jsonOverride =
                params?.commitType === "parameters"
                    ? get(parametersOverrideAtomFamily(variantId))
                    : null

            // Transform prompts when not using JSON override
            const transformedParameters =
                jsonOverride ?? get(transformedPromptsAtomFamily(variantId))

            // Based on API error "badly formed hexadecimal UUID string", the API expects a UUID
            // Let's try currentVariant.variantId (which should be a UUID) instead of variantName
            const savedVariant = await VariantAPI.saveVariant(
                currentVariant.variantId,
                transformedParameters,
                params.note,
            )

            // Ensure the fetched variant has the expected structure
            // The API might return a different format than what the UI expects
            if (!savedVariant.parameters && savedVariant.config) {
                // Transform config to parameters if needed
                savedVariant.parameters = savedVariant.config
            }

            // No local playground cache to clear in simplified model

            // Set user save flags using the writable atom for better reactivity
            // Use the variantId (not the revision ID) so the listener can find all revisions of this variant
            // Invalidate and wait for new revision id using focused waiter
            await set(invalidatePlaygroundQueriesAtom)
            const waitResult = await set(waitForNewRevisionAfterMutationAtom, {
                variantId: savedVariant.variantId || currentVariant.variantId || variantId,
                prevRevisionId: variantId,
                timeoutMs: 10_000,
            })

            if (waitResult.newestRevisionId && waitResult.newestRevisionId !== variantId) {
                const newRevisionId = waitResult.newestRevisionId
                const previousRevisionId = variantId

                const currentDisplayedVariants = get(selectedVariantsAtom)
                const updatedVariants = currentDisplayedVariants.map((id) =>
                    id === variantId ? newRevisionId : id,
                )
                // Update atom directly for immediate reactivity, then sync to URL
                set(selectedVariantsAtom, updatedVariants)
                void writePlaygroundSelectionToQuery(updatedVariants)
                duplicateChatHistoryForRevision({
                    get,
                    set,
                    sourceRevisionId: previousRevisionId,
                    targetRevisionId: newRevisionId,
                    displayedVariantsAfterSwap: updatedVariants,
                })
                // Clear draft state for the previous revision
                set(discardRevisionDraftAtom, variantId)
                set(parametersOverrideAtomFamily(variantId), null)
                return {
                    success: true,
                    // Ensure consumers (e.g. Commit modal) get the *new revision id*
                    // even if the backend returns a parent-variant payload.
                    variant: {
                        ...(savedVariant as any),
                        id: newRevisionId,
                        variantId: (savedVariant as any)?.variantId || currentVariant.variantId,
                    } as any,
                    message: `Variant saved successfully`,
                }
            }

            // No revision swap detected – clear any local edits for this revision
            set(discardRevisionDraftAtom, variantId)
            set(parametersOverrideAtomFamily(variantId), null)
            return {
                success: true,
                // No revision swap detected; keep the current revision id stable for callers.
                variant: {
                    ...(savedVariant as any),
                    id: variantId,
                    variantId: (savedVariant as any)?.variantId || currentVariant.variantId,
                } as any,
                message: "Variant saved successfully",
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to save variant",
            }
        }
    },
)

// Delete variant mutation atom
export const deleteVariantMutationAtom = atom(
    null,
    async (get, set, params: DeleteVariantParams | string): Promise<VariantCrudResult> => {
        try {
            const revisionId =
                typeof params === "string" ? params : (params?.variantId as string | undefined)
            if (!revisionId) throw new Error("Missing revision id for delete")

            // Get baseline for this revision from current list
            const initialList = (get(revisionListAtom) || []) as EnhancedVariant[]
            const currentRevision = initialList.find((r: any) => r.id === revisionId)
            if (!currentRevision) {
                throw new Error(`Revision ${revisionId} not found in playground state`)
            }

            const store = getDefaultStore()
            const variantId = (currentRevision as any).variantId

            // Perform server-side revision delete
            await deleteSingleVariantRevision(variantId, revisionId)

            // API call succeeded - the deletion is complete on the server
            // Now invalidate queries and update UI state

            // Invalidate and refetch all playground-related queries
            // This includes the entity package query keys that feed into playgroundRevisionListAtom
            await set(invalidatePlaygroundQueriesAtom)

            // Wait briefly for the revision to be removed from the list (best effort)
            const {newSelectedId} = await set(waitForRevisionRemovalAtom, {
                revisionId,
                variantId,
                timeoutMs: 5_000,
            })

            // Update selection: remove deleted revision, prefer same-variant newest
            const currentSelected = store.get(selectedVariantsAtom) || []
            let nextSelected = currentSelected.filter((id: string) => id !== revisionId)
            if (nextSelected.length === 0 && newSelectedId) {
                nextSelected = [newSelectedId]
            }
            void writePlaygroundSelectionToQuery(nextSelected)
            store.set(drawerVariantIdAtom, nextSelected[0] ?? null)

            // Always return success since the API call succeeded
            return {
                success: true,
                message: "Revision deleted successfully",
            }
        } catch (error) {
            // Surface backend error text if available
            const err: any = error
            const backendDetail =
                err?.response?.data?.detail ||
                err?.response?.data?.message ||
                err?.message ||
                "Failed to delete revision"
            message.error(String(backendDetail))
            return {
                success: false,
                error: String(backendDetail),
            }
        }
    },
)
