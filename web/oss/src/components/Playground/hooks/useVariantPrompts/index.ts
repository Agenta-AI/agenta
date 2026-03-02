import {useEffect, useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {
    revisionListAtom,
    moleculeBackedVariantAtomFamily,
    moleculeBackedPromptsAtomFamily,
} from "../../state/atoms"

/**
 * Lightweight hook that only subscribes to a specific variant's prompt IDs.
 * Uses a derived atom to prevent re-renders when prompt content changes.
 * Only re-renders when prompt IDs actually change (add/remove prompts).
 *
 * Prompts come from the entity-level derivation via moleculeBackedPromptsAtomFamily,
 * which falls back to revisionEnhancedPromptsAtomFamily (schema + parameters → Strategy 1).
 * No local seeding is needed — the entity layer is the single source of truth,
 * and the write path auto-seeds from entity data when the first mutation occurs.
 */
export function useVariantPrompts(variantId: string | undefined): {
    promptIds: string[]
    hasPrompts: boolean
    variantExists: boolean
    debug: {
        revisionCount: number
        promptCount: number
        variantId?: string
    }
} {
    const revisions = useAtomValue(revisionListAtom)
    const revisionCount = revisions?.length ?? 0

    // No playground clone needed: prompts are stored per-revision locally
    useEffect(() => {
        if (variantId && revisions) {
            const exists = revisions.some((rev) => rev.id === variantId)
            if (!exists && process.env.NODE_ENV === "development") {
                console.warn("[useVariantPrompts] Revision not found:", variantId)
            }
        }
    }, [variantId, revisions])

    const variantAtom = useMemo(() => {
        if (!variantId) return atom(null)
        return moleculeBackedVariantAtomFamily(variantId)
    }, [variantId])

    const variantPromptIdsAtom = useMemo(() => {
        if (!variantId) return atom<string[]>([])

        let previousIds: string[] = []
        return atom<string[]>((get) => {
            // Use molecule-backed prompts for single source of truth
            const prompts = get(moleculeBackedPromptsAtomFamily(variantId)) as any[]
            // Always use the prompt's stable __id as the identifier.
            // __name is a display label and not guaranteed to be unique or uuid-like
            const currentIds = (prompts || [])
                .map((p: any) => p?.__id as string)
                .filter((id: any): id is string => typeof id === "string" && id.length > 0)

            if (
                previousIds.length === currentIds.length &&
                previousIds.every((id, index) => id === currentIds[index])
            ) {
                return previousIds
            }

            previousIds = currentIds
            return currentIds
        })
    }, [variantId])

    const variant = useAtomValue(variantAtom)
    const promptIds = useAtomValue(variantPromptIdsAtom)

    const variantExists = Boolean(variant)
    const debug = useMemo(
        () => ({
            revisionCount,
            promptCount: promptIds.length,
        }),
        [promptIds.length, revisionCount],
    )

    useEffect(() => {
        if (process.env.NODE_ENV !== "production") {
            console.info("[useVariantPrompts]", {
                variantId,
                variantExists,
                ...debug,
            })
        }
    }, [variantId, variantExists, debug])

    return {
        promptIds,
        hasPrompts: promptIds.length > 0,
        variantExists,
        debug,
    }
}
