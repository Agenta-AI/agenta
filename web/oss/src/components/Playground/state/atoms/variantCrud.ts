import {message} from "@agenta/ui/app-message"
import {produce} from "immer"
import {atom} from "jotai"
import {getDefaultStore} from "jotai"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {queryClient} from "@/oss/lib/api/queryClient"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {deleteSingleVariantRevision} from "@/oss/services/playground/api"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {duplicateChatHistoryForRevision} from "@/oss/state/generation/utils"
import {clearLocalCustomPropsForRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {
    promptsAtomFamily,
    clearLocalPromptsForRevisionAtomFamily,
    transformedPromptsAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"
import {variantsAtom as parentVariantsAtom} from "@/oss/state/variant/atoms/fetcher"

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
import {variantByRevisionIdAtomFamily} from "./propertySelectors"
import {invalidatePlaygroundQueriesAtom, waitForNewRevisionAfterMutationAtom} from "./queries"
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
            // 1) If revisionId provided, get directly.
            // 2) Otherwise, derive it from the newest revision matching baseVariantName.
            let currentBaseRevision = revisionId
                ? get(variantByRevisionIdAtomFamily(revisionId))
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

            // Build ag_config from promptsAtomFamily + baseline non-prompt params
            // const variant = get(variantByRevisionIdAtomFamily(currentBaseRevision.id)) as any
            const prompts = get(promptsAtomFamily(currentBaseRevision.id))
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

            // Resolve baseId robustly: prefer adapted revision.baseId, fallback to parent variant
            const parentBaseId = (() => {
                try {
                    const parents = get(parentVariantsAtom) as any[]
                    const pv = parents.find((p) => p.variantId === currentBaseRevision.variantId)
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

                // Clear draft state for the base revision used to create the new variant
                try {
                    const baseRevisionIdForClear = (currentBaseRevision as any)?.id as
                        | string
                        | undefined
                    if (baseRevisionIdForClear) {
                        set(clearLocalPromptsForRevisionAtomFamily(baseRevisionIdForClear))
                        set(clearLocalCustomPropsForRevisionAtomFamily(baseRevisionIdForClear))
                        set(parametersOverrideAtomFamily(baseRevisionIdForClear), null)
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

            // Get current baseline revision by ID using focused selector
            const currentVariant = get(variantByRevisionIdAtomFamily(variantId)) as
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
                // Clear local prompts cache for the previous revision to revert live edits
                set(clearLocalPromptsForRevisionAtomFamily(variantId))
                // Clear any JSON editor override for the previous revision
                set(parametersOverrideAtomFamily(variantId), null)
                set(clearLocalCustomPropsForRevisionAtomFamily(variantId))
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

            // Clear any JSON editor override if present (no revision swap case)
            set(parametersOverrideAtomFamily(variantId), null)
            // No revision swap detected – clear any local edits for this revision
            set(clearLocalPromptsForRevisionAtomFamily(variantId))
            set(parametersOverrideAtomFamily(variantId), null)
            set(clearLocalCustomPropsForRevisionAtomFamily(variantId))
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
            const initialCount = initialList.length

            // Setup subscription to detect when revision list reflects removal
            const waitForRemoval = new Promise<void>((resolve) => {
                let unsub: undefined | (() => void)

                const onChange = () => {
                    try {
                        const list = (store as any).get(revisionListAtom) as EnhancedVariant[]
                        const exists = Array.isArray(list)
                            ? list.some((r) => r?.id === revisionId)
                            : false
                        const decreased = Array.isArray(list) ? list.length < initialCount : false
                        if (!exists && decreased) {
                            // Update selection: same-variant newest preferred, then global newest
                            const allSorted = (list || []).slice().sort((a: any, b: any) => {
                                const at = a?.updatedAtTimestamp ?? a?.createdAtTimestamp ?? 0
                                const bt = b?.updatedAtTimestamp ?? b?.createdAtTimestamp ?? 0
                                return bt - at
                            })
                            const sameVariantSorted = allSorted.filter(
                                (r: any) => r?.variantId === (currentRevision as any)?.variantId,
                            )
                            const preferred = sameVariantSorted[0]?.id || allSorted[0]?.id || null

                            const currentSelected = (store as any).get(selectedVariantsAtom) || []
                            let nextSelected = currentSelected.filter(
                                (id: string) => id !== revisionId,
                            )
                            if (nextSelected.length === 0 && preferred) nextSelected = [preferred]
                            void writePlaygroundSelectionToQuery(nextSelected)
                            ;(store as any).set(drawerVariantIdAtom, nextSelected[0] ?? null)
                            message.success("Revision deleted successfully")

                            if (unsub) unsub()
                            resolve()
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                // If store.sub is available, use it; otherwise poll
                if ((store as any).sub) {
                    unsub = (store as any).sub(revisionListAtom, onChange)
                } else {
                    const iv = setInterval(onChange, 200)
                    unsub = () => clearInterval(iv)
                }
            })

            // Perform server-side revision delete
            await deleteSingleVariantRevision((currentRevision as any).variantId, revisionId)

            // Invalidate and refetch variant-related queries (do not end mutation yet)
            await Promise.all([
                queryClient.invalidateQueries({queryKey: ["variants"]}),
                queryClient.invalidateQueries({queryKey: ["variantRevisions"]}),
            ])

            // Wait until the list reflects the removal and selection was updated
            await waitForRemoval

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
