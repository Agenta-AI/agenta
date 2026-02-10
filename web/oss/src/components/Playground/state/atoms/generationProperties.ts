/**
 * Generation-related atoms and selectors
 * Scope: chat/completion rows, history, results, and generation-derived data.
 */
import {generateId} from "@agenta/shared/utils"
import isEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai/utils"

import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {generationLogicalTurnIdsAtom as chatLogicalIdsAtom} from "@/oss/state/generation/compat"
import {inputRowIdsAtom, runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {rowResponsesForDisplayAtomFamily} from "@/oss/state/generation/selectors"
import {
    loadingByRowRevisionAtomFamily,
    responseByRowRevisionAtomFamily,
} from "@/oss/state/newPlayground/generation/runtime"

import {appChatModeAtom} from "./app"
import {displayedVariantsAtom} from "./variants"

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

        // Prefer new per-(row,rev) response content if present and combine with loading flag
        let result: any = undefined
        result = get(
            responseByRowRevisionAtomFamily({
                rowId: params.rowId,
                revisionId: params.variantId,
            }),
        )
        const isLoading = get(
            loadingByRowRevisionAtomFamily({rowId: params.rowId, revisionId: params.variantId}),
        )
        return {resultHash, isRunning: Boolean(isRunning || isLoading), result}
    }),
)

/**
 * Run status selector (Phase 1): reads generationData to compute status
 * Centralizing here allows swapping to normalized backing store later without touching consumers.
 */
export const generationRunStatusAtomFamily = atomFamily((p: {variantId: string; rowId: string}) =>
    atom((get) => {
        // Normalized-only run status and hash derivation (no legacy generationData reads)
        const key = `${p.rowId}:${p.variantId}`
        const normalized = get(runStatusByRowRevisionAtom)[key]
        let resultHash: string | null = normalized?.resultHash ?? null
        let isRunning = Boolean(normalized?.isRunning)

        // Fallback: derive hash from normalized responsesByRevision if not present
        if (!resultHash) {
            try {
                const responses = get(
                    rowResponsesForDisplayAtomFamily({rowId: p.rowId, revisionId: p.variantId}),
                ) as any[]
                if (Array.isArray(responses) && responses.length > 0) {
                    const last = responses[responses.length - 1]
                    const candidate = last?.content?.value ?? last?.content ?? last?.value
                    if (typeof candidate === "string") {
                        // Heuristic: MD5 hex string (32 hex chars) produced by buildCompletionResponseText
                        const isMd5 = /^[a-f0-9]{32}$/i.test(candidate)
                        if (isMd5) resultHash = candidate
                    }
                }
            } catch {}
        }

        return {resultHash, isRunning}
    }),
)

/**
 * Resolved generation result atom family
 * - Combines run status, loading flag, and resolves inline or hashed result into a single shape
 * - Reusable in both completion and chat components as a one-liner
 */
export const resolvedGenerationResultAtomFamily = atomFamily(
    (p: {variantId: string; rowId: string}) =>
        atom((get) => {
            const base = get(generationResultAtomFamily(p)) as any
            let isRunning = Boolean(base?.isRunning)
            // Merge in explicit loading flag when available
            try {
                const isLoading = get(
                    loadingByRowRevisionAtomFamily({rowId: p.rowId, revisionId: p.variantId}),
                )
                isRunning = Boolean(isRunning || isLoading)
            } catch {}
            const result = base?.result ?? getResponseLazy(base?.resultHash)
            return {isRunning, resultHash: base?.resultHash ?? null, result}
        }),
)

let _prevInputRowIds: string[] = []
export const generationInputRowIdsAtom = atom((get) => {
    const isChat = get(appChatModeAtom)

    if (isChat === undefined) return _prevInputRowIds

    if (isChat) {
        const next = ["row-__default__"]
        if (!isEqual(next, _prevInputRowIds)) _prevInputRowIds = next
        return _prevInputRowIds
    }

    if (!get(inputRowIdsAtom).length) {
        Promise.resolve().then(() => {
            const store = getDefaultStore()
            if ((store.get(inputRowIdsAtom) || []).length === 0) {
                store.set(inputRowIdsAtom, [`row-${generateId()}`])
            }
        })
    }

    const next = get(inputRowIdsAtom)
    if (!isEqual(next, _prevInputRowIds)) _prevInputRowIds = next
    return _prevInputRowIds
})
/**
 * Atom for generation row IDs based on chat vs input mode
 * Used by MainLayout for rendering GenerationComparisonOutput and PlaygroundGenerations
 * NOTE: Using plain atom with manual dedup instead of selectAtom because upstream
 * chatTurnIdsAtom uses getDefaultStore().set() side-effects inside its reader which
 * selectAtom doesn't properly track for re-evaluation.
 */
let _prevRowIds: string[] = []
export const generationRowIdsAtom = atom((get) => {
    const isChat = get(appChatModeAtom)
    let next: string[]
    if (isChat) {
        next = ((get(chatLogicalIdsAtom) as string[]) || []).filter(Boolean)
    } else {
        next = (get(inputRowIdsAtom) as string[]) || []
    }
    if (!isEqual(next, _prevRowIds)) _prevRowIds = next
    return _prevRowIds
})

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
