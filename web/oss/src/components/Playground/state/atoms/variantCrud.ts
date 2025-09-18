import {message} from "antd"
import {produce} from "immer"
import {atom} from "jotai"
import {getDefaultStore} from "jotai"

import {drawerVariantIdAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {queryClient} from "@/oss/lib/api/queryClient"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {deleteSingleVariantRevision} from "@/oss/services/playground/api"
import {
    chatTurnIdsAtom,
    chatTurnIdsByBaselineAtom,
    allChatTurnIdsMapAtom,
    chatTurnsByIdAtom,
    chatTurnsByIdCacheAtom,
} from "@/oss/state/generation/entities"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import {clearLocalCustomPropsForRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {
    promptsAtomFamily,
    clearLocalPromptsForRevisionAtomFamily,
    transformedPromptsAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"
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
import {updateUrlRevisionsAtom, userSaveStateAtom} from "./urlSync"
import {revisionListAtom} from "./variants"

import {
    variantByRevisionIdAtomFamily,
    waitForNewRevisionAfterMutationAtom,
    invalidatePlaygroundQueriesAtom,
} from "./index"

// import {variantOriginalParametersAtomFamily} from "./dirtyState"

/**
 * Phase 4.3: Variant CRUD Mutation Atoms
 * Atoms for creating, updating, and deleting variants with optimistic updates
 */

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

                set(updateUrlRevisionsAtom, updatedVariants)
                set(selectedVariantsAtom, updatedVariants)

                // Clear draft state for the base revision used to create the new variant
                try {
                    const baseRevisionId = (currentBaseRevision as any)?.id as string | undefined
                    if (baseRevisionId) {
                        set(clearLocalPromptsForRevisionAtomFamily(baseRevisionId))
                        set(clearLocalCustomPropsForRevisionAtomFamily(baseRevisionId))
                        set(parametersOverrideAtomFamily(baseRevisionId), null)
                    }
                } catch {}

                return {
                    success: true,
                    variant: createVariantResponse,
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
            const sessionVariantId = savedVariant.variantId || currentVariant.variantId || variantId
            const timestamp = Date.now().toString()

            // Update the atom which will also update session storage
            set(userSaveStateAtom, {
                userSavedVariant: sessionVariantId,
                userSaveTimestamp: timestamp,
            })

            // Invalidate and wait for new revision id using focused waiter
            await set(invalidatePlaygroundQueriesAtom)
            const waitResult = await set(waitForNewRevisionAfterMutationAtom, {
                variantId: sessionVariantId,
                prevRevisionId: variantId,
            })

            if (waitResult.newestRevisionId && waitResult.newestRevisionId !== variantId) {
                const newRevisionId = waitResult.newestRevisionId
                const previousRevisionId = variantId

                let logicalIdsForNewRevision: string[] = []

                try {
                    const baselineMap = get(chatTurnIdsByBaselineAtom) || {}
                    if (
                        Array.isArray(baselineMap[previousRevisionId]) &&
                        baselineMap[previousRevisionId].length > 0
                    )
                        logicalIdsForNewRevision = [...baselineMap[previousRevisionId]]
                    else {
                        const currentLogical = get(chatTurnIdsAtom)
                        logicalIdsForNewRevision = Array.isArray(currentLogical)
                            ? [...currentLogical]
                            : []
                    }

                    const persistedTurns = get(chatTurnsByIdAtom) as Record<string, any>
                    const cachedTurns = get(chatTurnsByIdCacheAtom) as Record<string, any>
                    const mergedTurns: Record<string, any> = {
                        ...(persistedTurns || {}),
                        ...(cachedTurns || {}),
                    }
                    const updatedEntries: Record<string, any> = {}

                    for (const [turnId, turnValue] of Object.entries(mergedTurns)) {
                        if (!turnValue) continue

                        const assistantMap = turnValue.assistantMessageByRevision || {}
                        const toolMap = turnValue.toolResponsesByRevision || {}
                        const hasAssistant = previousRevisionId in assistantMap
                        const hasTool = previousRevisionId in toolMap
                        if (!hasAssistant && !hasTool) continue

                        const clonedTurn = structuredClone(turnValue)
                        clonedTurn.id = turnId

                        if (!clonedTurn.assistantMessageByRevision)
                            clonedTurn.assistantMessageByRevision = {}
                        if (
                            hasAssistant &&
                            !(newRevisionId in clonedTurn.assistantMessageByRevision)
                        ) {
                            const assistantNode = clonedTurn.assistantMessageByRevision[
                                previousRevisionId
                            ]
                            clonedTurn.assistantMessageByRevision[newRevisionId] = assistantNode
                                ? structuredClone(assistantNode)
                                : null
                        }

                        if (!clonedTurn.toolResponsesByRevision)
                            clonedTurn.toolResponsesByRevision = {}
                        if (
                            hasTool &&
                            !(newRevisionId in clonedTurn.toolResponsesByRevision)
                        ) {
                            const toolNodes = clonedTurn.toolResponsesByRevision[
                                previousRevisionId
                            ]
                            clonedTurn.toolResponsesByRevision[newRevisionId] = toolNodes
                                ? structuredClone(toolNodes)
                                : toolNodes
                        }

                        updatedEntries[turnId] = clonedTurn
                    }

                    if (Object.keys(updatedEntries).length > 0) {
                        set(chatTurnsByIdCacheAtom, (prev) => ({
                            ...(prev || {}),
                            ...updatedEntries,
                        }))
                    }

                    if (logicalIdsForNewRevision.length > 0) {
                        set(chatTurnIdsByBaselineAtom, (prev) => ({
                            ...(prev || {}),
                            [newRevisionId]: [...logicalIdsForNewRevision],
                        }))
                    }
                } catch (error) {
                    console.warn("Failed to duplicate chat history for committed revision", error)
                }

                const currentDisplayedVariants = get(selectedVariantsAtom)
                const updatedVariants = currentDisplayedVariants.map((id) =>
                    id === variantId ? newRevisionId : id,
                )
                // Update selected variants so the UI switches to the new revision immediately
                set(selectedVariantsAtom, updatedVariants)
                set(updateUrlRevisionsAtom, updatedVariants)
                if (logicalIdsForNewRevision.length > 0) {
                    const newKey = `set:${[...updatedVariants].sort().join("|")}`
                    set(allChatTurnIdsMapAtom, (prev) => ({
                        ...(prev || {}),
                        [newKey]: [...logicalIdsForNewRevision],
                    }))
                }
                // Clear local prompts cache for the previous revision to revert live edits
                set(clearLocalPromptsForRevisionAtomFamily(variantId))
                // Clear any JSON editor override for the previous revision
                set(parametersOverrideAtomFamily(variantId), null)
                return {
                    success: true,
                    variant: savedVariant,
                    message: `Variant saved successfully`,
                }
            }

            // Clear any JSON editor override if present (no revision swap case)
            set(parametersOverrideAtomFamily(variantId), null)
            // No revision swap detected – clear any local edits for this revision
            set(clearLocalPromptsForRevisionAtomFamily(variantId))
            set(parametersOverrideAtomFamily(variantId), null)
            return {
                success: true,
                variant: savedVariant,
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
                            ;(store as any).set(selectedVariantsAtom, nextSelected)
                            ;(store as any).set(updateUrlRevisionsAtom, nextSelected)
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

// Batch variant operations atom
export const batchVariantOperationsMutationAtom = atom(
    null,
    async (
        get,
        set,
        operations: {
            type: "add" | "save" | "delete"
            params: AddVariantParams | SaveVariantParams | DeleteVariantParams
        }[],
    ): Promise<VariantCrudResult[]> => {
        const results: VariantCrudResult[] = []

        for (const operation of operations) {
            try {
                let result: VariantCrudResult

                switch (operation.type) {
                    case "add":
                        result = await set(
                            addVariantMutationAtom,
                            operation.params as AddVariantParams,
                        )
                        break
                    case "save":
                        result = await set(
                            saveVariantMutationAtom,
                            operation.params as SaveVariantParams,
                        )
                        break
                    case "delete":
                        result = await set(
                            deleteVariantMutationAtom,
                            operation.params as DeleteVariantParams,
                        )
                        break
                    default:
                        result = {
                            success: false,
                            error: `Unknown operation type: ${(operation as any).type}`,
                        }
                }

                results.push(result)
            } catch (error) {
                results.push({
                    success: false,
                    error: error instanceof Error ? error.message : "Batch operation failed",
                })
            }
        }

        return results
    },
)
