/**
 * Generation-related atoms and selectors
 * Scope: chat/completion rows, history, results, and generation-derived data.
 */
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {runStatusByRowRevisionAtom, inputRowIdsAtom} from "@/oss/state/generation/entities"
import {rowVariablesAtomFamily} from "@/oss/state/generation/selectors"
import {rowResponsesForDisplayAtomFamily} from "@/oss/state/generation/selectors"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {getEnhancedRevisionById} from "@/oss/state/variant/atoms/fetcher"
import {appUriInfoAtom, getSpecLazy} from "@/oss/state/variant/atoms/fetcher"

import {playgroundStateAtom} from "./core"
import {displayedVariantsAtom} from "./variants"

/**
 * Strict input row IDs selector (reads only generationData.inputs)
 * Used by GenerationCompletion to list variable rows regardless of mode
 */
// Normalized: strict input row ids come from normalized entity list
export const inputRowIdsStrictAtom = selectAtom(
    atom((get) => get(inputRowIdsAtom)),
    (ids) => ids,
    isEqual,
)

/**
 * Returns a mapping of message row ID -> array of history IDs
 * Appends a synthetic "isRunning-<id>" entry if the latest history is running for the given variantId
 */
// Legacy chat history/message selectors removed in favor of normalized chat turns

/**
 * Header data for generations view (aggregated running state and result hashes)
 */
export const generationHeaderDataAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        // Prefer normalized run status map which is updated for both completion and chat
        const runStatus = get(runStatusByRowRevisionAtom) || {}
        const suffix = `:${variantId}`
        const entries = Object.entries(runStatus).filter(([key]) => key.endsWith(suffix))

        const resultHashes = entries
            .map(([, v]) => v?.resultHash)
            .filter((h): h is string => typeof h === "string" && h.length > 0)
        const isRunning = entries.some(([, v]) => Boolean(v?.isRunning))

        return {resultHashes, isRunning}
    }),
)

/**
 * Atom family for generation result data (completion and chat modes)
 * Used by GenerationCompletionRow for result hash and running state
 */
export const generationResultAtomFamily = atomFamily((params: {variantId: string; rowId: string}) =>
    atom((get) => {
        // Delegate to a dedicated run-status selector to enable future migration
        const {resultHash, isRunning} = get(
            generationRunStatusAtomFamily({variantId: params.variantId, rowId: params.rowId}),
        )

        // Variables for this row via normalized store
        const displayed = get(displayedVariantsAtom) || []
        const revisionId = displayed?.[0] || params.variantId
        const vars = revisionId
            ? get(rowVariablesAtomFamily({rowId: params.rowId, revisionId})) || []
            : []
        const variableIds = (vars as any[]).map((n: any) => n?.__id).filter(Boolean)

        return {resultHash, isRunning, variableIds}
    }),
)

/**
 * Run status selector (Phase 1): reads legacy generationData to compute status
 * Centralizing here allows swapping to normalized backing store later without touching consumers.
 */
export const generationRunStatusAtomFamily = atomFamily((p: {variantId: string; rowId: string}) =>
    atom((get) => {
        // Prefer normalized run status when available
        const key = `${p.rowId}:${p.variantId}`
        const normalized = get(runStatusByRowRevisionAtom)[key]
        if (normalized) {
            return {
                resultHash: normalized.resultHash ?? null,
                isRunning: Boolean(normalized.isRunning),
            }
        }

        const playgroundState = get(playgroundStateAtom)
        const generationData = playgroundState.generationData

        // Detect chat vs completion using OpenAPI schema
        const isChatVariant = (() => {
            const spec = getSpecLazy()
            const appUri = get(appUriInfoAtom)
            if (spec) {
                const properties = (
                    spec.paths[
                        (appUri?.runtimePrefix || "") + (appUri?.routePath || "") + "/run"
                    ] ||
                    spec.paths[(appUri?.runtimePrefix || "") + (appUri?.routePath || "") + "/test"]
                )?.post?.requestBody?.content["application/json"]?.schema?.properties
                return properties?.messages !== undefined
            }

            return false
        })()

        let resultHash: string | null = null
        let isRunning = false

        if (isChatVariant) {
            // For chat, prefer normalized run status already handled above; no legacy fallback
            resultHash = normalized?.resultHash ?? null
            isRunning = Boolean(normalized?.isRunning)
        } else {
            const inputRows = (generationData?.inputs?.value as any[]) || []
            const row = inputRows.find((r: any) => r.__id === p.rowId)
            resultHash = (row as any)?.__runs?.[p.variantId]?.__result ?? null
            isRunning = !!(row as any)?.__runs?.[p.variantId]?.__isRunning
        }

        return {resultHash, isRunning}
    }),
)

/**
 * Atom for generation row IDs based on chat vs input mode
 * Used by MainLayout for rendering GenerationComparisonOutput and PlaygroundGenerations
 * PERFORMANCE OPTIMIZATION: Use selectAtom to prevent re-renders during local mutations
 */
export const generationRowIdsAtom = selectAtom(
    atom((get) => {
        const playgroundState = get(playgroundStateAtom)
        const displayedVariantIds = get(displayedVariantsAtom)
        const selectedVariantId = displayedVariantIds?.[0]
        const currentVariant = selectedVariantId
            ? (getEnhancedRevisionById(get, selectedVariantId) as any)
            : null
        const uriInfo = get(appUriInfoAtom)
        const flags = currentVariant
            ? get(
                  variantFlagsAtomFamily({
                      variant: currentVariant,
                      revisionId: selectedVariantId,
                      routePath: uriInfo?.routePath,
                  }),
              )
            : {isChat: false}
        return {
            generationData: playgroundState.generationData,
            isChatVariant: Boolean(flags.isChat),
        }
    }),
    (state) => {
        const generationData = state.generationData
        if (!generationData) {
            return []
        }

        const messageRows = generationData.messages?.value || []
        const inputRows = (generationData.inputs?.value as any[]) || []

        // Use variant flag to determine which data to read from
        if (state.isChatVariant) {
            return (messageRows as any[]).map((message: any) => message.__id).filter(Boolean)
        } else {
            return inputRows.map((input: any) => input.__id).filter(Boolean)
        }
    },
    isEqual, // Only re-render if the actual row IDs change
)

/**
 * Derived: visible trace node IDs for the current Playground view
 * - For chat, includes all assistant responses per row (normalized responses)
 * - For completion, includes the latest result per row
 * Consumers can use this to drive TraceDrawer navigation
 */
export const generationTraceIdsAtom = atom((get) => {
    const displayedVariantIds = get(displayedVariantsAtom) || []
    const revisionId = displayedVariantIds?.[0]
    if (!revisionId) return [] as string[]

    const rowIds = get(generationRowIdsAtom) as string[]
    const playgroundState = get(playgroundStateAtom)
    const nav: string[] = []

    for (const rowId of rowIds) {
        // Prefer normalized responses if available (captures multiple chat messages)
        const normalized = get(rowResponsesForDisplayAtomFamily({rowId, revisionId})) as any[]
        if (Array.isArray(normalized) && normalized.length > 0) {
            for (const n of normalized) {
                const hash = n?.content?.value
                const res = getResponseLazy(hash)
                const id = (res as any)?.response?.tree?.nodes?.[0]?.node?.id
                if (id) nav.push(id)
            }
            continue
        }

        // Fallback to latest result hash from run status
        const {resultHash} = get(generationRunStatusAtomFamily({variantId: revisionId, rowId}))
        let res = getResponseLazy(resultHash)
        let id = (res as any)?.response?.tree?.nodes?.[0]?.node?.id

        // Extra fallback: if completion row stored inline __result object, use it
        if (!id) {
            const inputRows = (playgroundState?.generationData?.inputs?.value as any[]) || []
            const row = inputRows.find((r: any) => r?.__id === rowId)
            const inline = row?.__runs?.[revisionId]?.__result
            if (inline && typeof inline === "object") {
                id = (inline as any)?.response?.tree?.nodes?.[0]?.node?.id
            }
        }

        if (id) nav.push(id)
    }

    // Filter and dedupe while preserving order
    const seen = new Set<string>()
    const cleaned = nav.filter((id) => {
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
    })
    return cleaned
})

/**
 * Atom family for input row IDs, resolving mode from selected revision.
 */
export const inputRowIdsAtomFamily = atomFamily(
    (params: {variantId?: string; rowId?: string} = {}) =>
        atom((get) => {
            const playgroundState = get(playgroundStateAtom)
            // Determine mode from selected revision
            const displayedVariantIds = get(displayedVariantsAtom)
            const selectedVariantId = displayedVariantIds?.[0]
            const currentVariant = selectedVariantId
                ? (getEnhancedRevisionById(get, selectedVariantId) as any)
                : null
            const uriInfo = get(appUriInfoAtom)
            const flags = currentVariant
                ? get(
                      variantFlagsAtomFamily({
                          variant: currentVariant,
                          revisionId: selectedVariantId,
                          routePath: uriInfo?.routePath,
                      }),
                  )
                : {isChat: false}
            const isChatVariant = Boolean(flags.isChat)

            // Get rows based on mode
            const rows = isChatVariant
                ? playgroundState.generationData?.messages?.value || []
                : playgroundState.generationData?.inputs?.value || []

            if (params.rowId) {
                // Find specific row ID
                const inputRow = rows.find((row: any) => row.__id === params.rowId)
                return {
                    inputRowId: inputRow?.__id || null,
                    inputRowIds: rows.map((row: any) => row.__id),
                }
            }

            return {
                inputRowId: rows[0]?.__id || null,
                inputRowIds: rows.map((row: any) => row.__id),
            }
        }),
)
