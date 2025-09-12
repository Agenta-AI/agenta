import {atom} from "jotai"

import {inputRowsByIdAtom} from "@/oss/state/generation/entities"

import {appChatModeAtom} from "./app"
import {
    ensureChatSessionsForDisplayedRevisionsAtom,
    normalizeComparisonChatTurnsMutationAtom,
    pruneLogicalTurnIndexForDisplayedVariantsMutationAtom,
    regenerateSingleModeChatFromActiveRevisionAtom,
    forceSyncPromptVariablesToNormalizedAtom,
} from "./generationMutations"
import {displayedVariantsAtom} from "./variants"

/**
 * Comparison/Single Mode Orchestrators
 * Centralize multi-atom updates to avoid partial, interleaved state during mode switches.
 */

export const enterComparisonOrchestratorAtom = atom(null, (get, set) => {
    const isChat = get(appChatModeAtom)
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    if (!isChat) return
    if (!Array.isArray(displayed) || displayed.length <= 1) return

    try {
        // 1) Ensure sessions for all displayed revisions (no-op if present)
        set(ensureChatSessionsForDisplayedRevisionsAtom)
    } catch {}
    try {
        // 2) Prune logical index to displayed revs only (avoid stale mappings)
        set(pruneLogicalTurnIndexForDisplayedVariantsMutationAtom)
    } catch {}
    try {
        // 3) Normalize/backfill turns and per-revision mappings
        set(normalizeComparisonChatTurnsMutationAtom)
    } catch {}
    try {
        // 4) Seed normalized variables for newly displayed revisions from baseline normalized inputs
        const displayedIds = (get(displayedVariantsAtom) || []) as string[]
        if (Array.isArray(displayedIds) && displayedIds.length > 1) {
            const baseline = displayedIds[0]
            const others = displayedIds.slice(1)
            if (baseline) {
                set(inputRowsByIdAtom, (prev) => {
                    const next: any = {...prev}
                    for (const [rowId, row] of Object.entries(next || {})) {
                        const byRev: Record<string, any[]> = (row as any)?.variablesByRevision || {}
                        const baseNodes = (byRev?.[baseline] || []) as any[]
                        if (!Array.isArray(baseNodes) || baseNodes.length === 0) continue
                        for (const revId of others) {
                            const current = byRev?.[revId]
                            if (!Array.isArray(current) || current.length === 0) {
                                // shallow-clone nodes best-effort; values are primitives or small objects
                                const cloned = baseNodes.map((n: any) => ({...n}))
                                byRev[revId] = cloned
                            }
                        }
                        next[rowId] = {...(row as any), variablesByRevision: byRev}
                    }
                    return next
                })
            }
        }
    } catch {}
    try {
        // 5) Sync variables for displayed revs (ensures row vars exist)
        set(forceSyncPromptVariablesToNormalizedAtom)
    } catch {}
})

export const exitComparisonOrchestratorAtom = atom(null, (get, set) => {
    const isChat = get(appChatModeAtom)
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    if (!isChat) return
    if (!Array.isArray(displayed) || displayed.length !== 1) return

    try {
        // 1) Rebuild single-mode state keeping only active revision
        set(regenerateSingleModeChatFromActiveRevisionAtom)
    } catch {}
    try {
        // 2) Normalize userMessage nodes to guarantee role/content/value
        set(normalizeComparisonChatTurnsMutationAtom)
    } catch {}
    try {
        // 3) Re-sync variables for the active revision
        set(forceSyncPromptVariablesToNormalizedAtom)
    } catch {}
})
