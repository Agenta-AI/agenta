/*
 * useStatelessVariants – Stateless hook that surfaces the variants bundle directly
 * from Jotai atoms (replaces the removed `useVariantsBundle`).
 */
import {useQueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {useAtomValue} from "jotai/react"

import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {
    appSchemaAtom,
    appUriInfoAtom,
    variantsAtom,
    // centralized derived atoms
    revisionMapAtom,
    sortedEnhancedRevisionsAtom,
    allVariantsLoadingAtom,
    variantsLoadingAtom,
    revisionsPendingAtom,
    enhancedVariantsLoadableAtom,
} from "@/oss/state/variant/atoms/fetcher"

export interface VariantsBundle {
    variants: EnhancedVariant[]
    revisionMap: Record<string, EnhancedVariant[]>
    specMap: Record<string, unknown | undefined>
    uriMap: Record<string, {runtimePrefix: string; routePath?: string} | undefined>
    isLoading: boolean
    refetch: () => Promise<void>
}

export interface UseStatelessVariantsOptions {
    // When true, excludes OpenAPI/spec readiness from loading computation.
    // Useful for flows (e.g., evaluation preview) that don't require the spec.
    lightLoading?: boolean
}

// Use centralized derived atoms from fetcher (no local re-definition)

function useStatelessVariants(options: UseStatelessVariantsOptions = {}): VariantsBundle {
    const {lightLoading = false} = options
    const rootStore = getDefaultStore()
    // Synthesize legacy revisionMap shape from normalized atoms for compatibility
    const revisionMap = useAtomValue(revisionMapAtom, {store: rootStore})
    const appSchema = useAtomValue(appSchemaAtom, {store: rootStore})
    const appUriInfo = useAtomValue(appUriInfoAtom, {store: rootStore})
    const heavyLoading = useAtomValue(allVariantsLoadingAtom, {store: rootStore})
    const variantsLoading = useAtomValue(variantsLoadingAtom, {store: rootStore})
    const revisionsPending = useAtomValue(revisionsPendingAtom, {store: rootStore})
    const enhancedLoadable = useAtomValue(enhancedVariantsLoadableAtom, {store: rootStore})

    // Determine if variants query is enabled (same conditions as variantsQueryAtom)
    const projectId = useAtomValue(projectIdAtom, {store: rootStore}) as string | undefined
    const routerAppId = useAtomValue(routerAppIdAtom, {store: rootStore}) as
        | string
        | null
        | undefined
    const enabled = !!routerAppId && routerAppId !== null && !!projectId

    // If there are no variants and we're not actively loading variants, do not block on revisions
    const noVariants = useAtomValue(variantsAtom, {store: rootStore}).length === 0
    const effectiveRevisionsPending = noVariants && !variantsLoading ? false : revisionsPending

    // Treat disabled query as not-loading for light mode
    const variantsLoadingEff = enabled ? variantsLoading : false
    const enhancedPendingEff = enabled ? enhancedLoadable.state !== "hasData" : false

    const lightLoadingState = variantsLoadingEff || effectiveRevisionsPending || enhancedPendingEff

    const refetch = useGlobalVariantsRefetch()

    const vars = useAtomValue(sortedEnhancedRevisionsAtom, {store: rootStore})

    // Synthesize per-variant maps from app-level atoms to preserve API shape
    const variantIds = Array.from(new Set(vars.map((v: EnhancedVariant) => v.variantId)))
    const specMap: Record<string, unknown | undefined> = {}
    const uriMap: Record<string, {runtimePrefix: string; routePath?: string} | undefined> = {}
    variantIds.forEach((id) => {
        specMap[id] = appSchema
        uriMap[id] = appUriInfo
            ? {
                  runtimePrefix: appUriInfo.runtimePrefix,
                  routePath: appUriInfo.routePath,
              }
            : undefined
    })

    return {
        variants: vars,
        revisionMap,
        revisions: Object.values(revisionMap).flat(),
        specMap,
        uriMap,
        isLoading: lightLoading ? lightLoadingState : heavyLoading,
        refetch,
    }
}

export default useStatelessVariants

export const useGlobalVariantsRefetch = () => {
    const queryClient = useQueryClient()
    return () => queryClient.invalidateQueries({queryKey: ["variants"]})
}
