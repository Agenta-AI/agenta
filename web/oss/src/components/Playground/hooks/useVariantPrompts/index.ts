import {useEffect, useMemo} from "react"

import {atom, useAtomValue, useSetAtom} from "jotai"

import {derivePromptsFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {revisionListAtom, variantByRevisionIdAtomFamily} from "../../state/atoms"

/**
 * Lightweight hook that only subscribes to a specific variant's prompt IDs.
 * Uses a derived atom to prevent re-renders when prompt content changes.
 * Only re-renders when prompt IDs actually change (add/remove prompts).
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
    const spec = useAtomValue(appSchemaAtom)
    const routePath = useAtomValue(appUriInfoAtom)?.routePath

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
        return variantByRevisionIdAtomFamily(variantId)
    }, [variantId])

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

    const variant = useAtomValue(variantAtom)
    const promptIds = useAtomValue(variantPromptIdsAtom)
    const setPrompts = useSetAtom(variantId ? promptsAtomFamily(variantId) : atom([]))

    useEffect(() => {
        if (!variantId || !variant || !spec) return
        if (promptIds.length > 0) return
        const derived = derivePromptsFromSpec(variant as any, spec as any, routePath)
        if (Array.isArray(derived) && derived.length > 0) {
            setPrompts(derived as any)
        }
    }, [variantId, promptIds.length, variant, spec, routePath, setPrompts])

    const debug = useMemo(
        () => ({
            revisionCount,
            promptCount: promptIds.length,
            variantId,
        }),
        [promptIds.length, revisionCount, variantId],
    )

    useEffect(() => {
        if (process.env.NODE_ENV !== "production") {
            console.info("[useVariantPrompts]", {
                variantId,
                variantExists: Boolean(variant),
                ...debug,
            })
        }
    }, [variantId, variant, debug])

    return {
        promptIds,
        hasPrompts: promptIds.length > 0,
        variantExists: Boolean(variant),
        debug,
    }
}
