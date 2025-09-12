import {atom} from "jotai"

import {routerAtom} from "../../router"

/**
 * Deep Link Detection Atoms
 * Pure atoms that extract deep link information from URL state
 */

export interface DeepLinkContext {
    revisionIds: string[]
    variantIds: string[]
    selectedVariant: string | null
    priorityIds: string[]
}

// Pure atom - extracts deep link information from router state
export const deepLinkContextAtom = atom<DeepLinkContext>((get) => {
    const router = get(routerAtom)
    const searchParams = new URLSearchParams((router.query as any) || {})

    const revisionIds = searchParams.get("revisions")?.split(",").filter(Boolean) || []
    const variantIds = searchParams.get("variants")?.split(",").filter(Boolean) || []
    const selectedVariant = searchParams.get("variant")

    return {
        revisionIds,
        variantIds,
        selectedVariant,
        priorityIds: [...revisionIds, ...variantIds, selectedVariant].filter(Boolean) as string[],
    }
})

// Derived atom - checks if any deep links are present
export const hasDeepLinksAtom = atom((get) => {
    const context = get(deepLinkContextAtom)
    return context.priorityIds.length > 0
})

// Derived atom - gets priority configuration for queries
export const deepLinkPriorityConfigAtom = atom((get) => {
    const context = get(deepLinkContextAtom)
    const hasLinks = get(hasDeepLinksAtom)

    return {
        priorityIds: context.priorityIds,
        hasPriority: hasLinks,
        // Shorter cache time for priority items
        staleTime: hasLinks ? 1000 * 30 : 1000 * 60,
        // More aggressive refetch for deep links
        refetchOnMount: hasLinks,
        refetchOnWindowFocus: hasLinks,
    }
})
