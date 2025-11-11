import {useMemo, useEffect} from "react"

import {atom, useAtomValue} from "jotai"

import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

import {revisionListAtom, variantByRevisionIdAtomFamily} from "../../state/atoms"

/**
 * Lightweight hook that only subscribes to a specific variant's prompt IDs.
 * Uses a derived atom to prevent re-renders when prompt content changes.
 * Only re-renders when prompt IDs actually change (add/remove prompts).
 */
export function useVariantPrompts(variantId: string | undefined): {
    promptIds: string[]
    hasPrompts: boolean
} {
    const revisions = useAtomValue(revisionListAtom)

    // No playground clone needed: prompts are stored per-revision locally
    useEffect(() => {
        if (variantId && revisions) {
            const exists = revisions.some((rev) => rev.id === variantId)
            if (!exists && process.env.NODE_ENV === "development") {
                console.warn("[useVariantPrompts] Revision not found:", variantId)
            }
        }
    }, [variantId, revisions])

    const variantPromptIdsAtom = useMemo(() => {
        if (!variantId) return atom<string[]>([])

        let previousIds: string[] = []
        return atom<string[]>((get) => {
            // const variant = get(variantByRevisionIdAtomFamily(variantId)) as any
            const prompts = get(promptsAtomFamily(variantId)) as any[]
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

    // Subscribe only to the prompt IDs, not the entire variant
    const promptIds = useAtomValue(variantPromptIdsAtom)

    return {
        promptIds,
        hasPrompts: promptIds.length > 0,
    }
}
