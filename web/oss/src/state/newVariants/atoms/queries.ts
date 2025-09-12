import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import type {ApiVariant, VariantRevision} from "@/oss/lib/Types"

import {fetchAppVariants, fetchAllRevisions, variantToRevision} from "../api/variants"

// Environment variables for configuration
const appId = process.env.VITEST_TEST_APP_ID || ""

// Latest revisions atom (for overview tables) - derived from variants to eliminate duplicate API calls
export const latestRevisionsAtom = atom((get) => {
    const variantsResult = get(variantsAtom)

    if (!variantsResult?.data?.variants) {
        return {isLoading: variantsResult?.isLoading, isError: variantsResult?.isError, data: []}
    }

    // Transform variants to revisions and get latest 5
    const latestRevisions = variantsResult.data.variants
        .map((variant: any) => variantToRevision(variant))
        .sort((a: any, b: any) => b.updatedAtTimestamp - a.updatedAtTimestamp)
        .slice(0, 5)

    return {
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: latestRevisions,
    }
})

// All variants atom (for search/filtering) - optimized with caching
export const variantsAtom = atomWithQuery(() => ({
    queryKey: ["variants", appId],
    queryFn: () => fetchAppVariants(appId),
    enabled: !!appId,
    staleTime: 30000, // Cache for 30 seconds
    gcTime: 300000, // Keep in cache for 5 minutes
}))

// All revisions atom (for registry pages) - optimized with caching
export const allRevisionsAtom = atomWithQuery(() => ({
    queryKey: ["allRevisions", appId],
    queryFn: () => fetchAllRevisions(appId),
    enabled: !!appId,
    staleTime: 60000, // Cache for 1 minute (revisions change less frequently)
    gcTime: 600000, // Keep in cache for 10 minutes
}))

// Bridge atoms for appStatus compatibility with revision-centric data
// These extract URI information directly from variant data instead of relying on URI maps

// Global app status atom - checks if any variant has a URI (playground available)
export const revisionCentricAppStatusAtom = atom((get) => {
    const variantsResult = get(variantsAtom)

    if (!variantsResult?.data?.variants) {
        return false
    }

    // Check if any variant has a URI
    return variantsResult.data.variants.some(
        (variant: any) => variant.uri && variant.uri.trim() !== "",
    )
})

// Per-variant app status atom family - checks if specific variant has URI
export const revisionCentricVariantAppStatusAtom = (variantId: string) =>
    atom((get) => {
        const variantsResult = get(variantsAtom)

        if (!variantsResult?.data?.variants) {
            return false
        }

        // Find the specific variant and check if it has a URI
        const variant = variantsResult.data.variants.find(
            (v: any) => v.variant_id === variantId || v.variantId === variantId,
        )

        return variant ? variant.uri && variant.uri.trim() !== "" : false
    })

// Lightweight table data interface - only fields needed for table display
// Core lightweight table variant (no derived fields)
export interface CoreTableVariant {
    id: string
    variantId: string
    variantName: string
    name: string
    revision: number
    parameters: Record<string, unknown>
    createdAt: string
    updatedAt: string
    createdBy: string
    modifiedBy: string
    commitMessage?: string
    isLatestRevision: boolean
    uri?: string
    children?: CoreTableVariant[]
}

// Extended interface for backward compatibility (includes derived fields)
export interface TableVariant extends CoreTableVariant {
    deployedIn?: string[]
    _parentVariant?: {
        id: string
        name: string
        variantName: string
        variantId: string
        revision: number
        createdAt: string
        updatedAt: string
        createdBy: any
    }
}

// Derived data types
export interface VariantDeployment {
    variantId: string
    environments: string[]
}

export interface VariantParent {
    id: string
    name: string
    variantName: string
    variantId: string
    revision: number
    createdAt: string
    updatedAt: string
    createdBy: any
}

// Derived atoms for deployment and parent data

// Atom family for variant deployment information (aggregated from revisions)
// Using eager evaluation for improved table loading performance
export const variantDeploymentAtomFamily = atomFamily((variantId: string) =>
    eagerAtom((get) => {
        const allRevisionsResult = get(allRevisionsAtom)

        if (allRevisionsResult.status !== "success") {
            return []
        }

        // Find all revisions for this variant and aggregate their deployments
        const variantRevisions = allRevisionsResult.data.filter(
            (revision) => revision.variantId === variantId,
        )

        // Collect unique deployment environment names from all revisions
        const deploymentNames = new Set<string>()
        variantRevisions.forEach((revision) => {
            revision.deployedIn?.forEach((env) => {
                deploymentNames.add(env.name)
            })
        })

        return Array.from(deploymentNames)
    }),
)

// Atom family for variant parent information
// Using eager evaluation for improved table loading performance
export const variantParentAtomFamily = atomFamily((variantId: string) =>
    eagerAtom((get) => {
        const variantsResult = get(variantsAtom)
        const allRevisionsResult = get(allRevisionsAtom)

        console.log("NEW variantParentAtomFamily")
        // First check variants data
        if (variantsResult?.data?.variants) {
            const variant = variantsResult.data.variants.find((v) => v.variant_id === variantId)
            if (variant) {
                return {
                    id: variant.variant_id,
                    name: variant.variant_name,
                    variantName: variant.variant_name,
                    variantId: variant.variant_id,
                    revision: variant.revision,
                    createdAt: variant.created_at,
                    updatedAt: variant.updated_at,
                    createdBy: variant.modified_by_id,
                }
            }
        }

        // Then check revisions data
        if (allRevisionsResult?.data) {
            const revision = allRevisionsResult.data.find((r) => r.variantId === variantId)
            if (revision) {
                return {
                    id: revision.variantId,
                    name: revision.config?.configName || `Variant ${revision.variantId}`,
                    variantName: revision.config?.configName || `Variant ${revision.variantId}`,
                    variantId: revision.variantId,
                    revision: revision.revision,
                    createdAt: revision.createdAt,
                    updatedAt: revision.createdAt,
                    createdBy: revision.modifiedBy,
                }
            }
        }

        return undefined
    }),
)

// Transform API data to core lightweight table format (no derived fields)
export function transformToCoreTableVariant(apiVariant: ApiVariant): CoreTableVariant {
    return {
        id: `${apiVariant.variant_id}_${apiVariant.revision}`,
        variantId: apiVariant.variant_id,
        variantName: apiVariant.variant_name,
        name: apiVariant.variant_name,
        revision: apiVariant.revision,
        parameters: apiVariant.parameters,
        createdAt: apiVariant.created_at,
        updatedAt: apiVariant.updated_at,
        createdBy: apiVariant.modified_by_id,
        modifiedBy: apiVariant.modified_by_id,
        commitMessage: undefined,
        isLatestRevision: true,
        uri: apiVariant.uri,
    }
}

// Legacy transform function for backward compatibility
export function transformToTableVariant(apiVariant: ApiVariant): TableVariant {
    const core = transformToCoreTableVariant(apiVariant)
    return {
        ...core,
        deployedIn: [], // Legacy - would be derived
        _parentVariant: {
            id: apiVariant.variant_id,
            name: apiVariant.variant_name,
            variantName: apiVariant.variant_name,
            variantId: apiVariant.variant_id,
            revision: apiVariant.revision,
            createdAt: apiVariant.created_at,
            updatedAt: apiVariant.updated_at,
            createdBy: apiVariant.modified_by_id,
        },
    }
}

// Transform revision to core lightweight table format (no derived fields)
export function transformRevisionToCoreTableVariant(revision: VariantRevision): CoreTableVariant {
    return {
        id: `${revision.variantId}_${revision.revision}`,
        variantId: revision.variantId,
        variantName: revision.config?.configName || `Variant ${revision.variantId}`,
        name: revision.config?.configName || `Variant ${revision.variantId}`,
        revision: revision.revision,
        parameters: revision.config?.parameters || {},
        createdAt: revision.createdAt,
        updatedAt: revision.createdAt,
        createdBy: revision.modifiedBy || "",
        modifiedBy: revision.modifiedBy || "",
        commitMessage: revision.commitMessage || undefined,
        isLatestRevision: revision.isLatestRevision,
        uri: undefined,
    }
}

// Legacy transform function for backward compatibility
function transformRevisionToTableVariant(revision: VariantRevision): TableVariant {
    const core = transformRevisionToCoreTableVariant(revision)
    return {
        ...core,
        // Deployment info is derived by selector atoms, not embedded in revision objects
        deployedIn: [],
        _parentVariant: {
            id: revision.variantId,
            name: revision.config?.configName || `Variant ${revision.variantId}`,
            variantName: revision.config?.configName || `Variant ${revision.variantId}`,
            variantId: revision.variantId,
            revision: revision.revision,
            createdAt: revision.createdAt,
            updatedAt: revision.createdAt,
            createdBy: revision.modifiedBy,
        },
    }
}

// Core lightweight table atoms (no derived fields)

// Core table variants atom - lightweight format without derived fields
export const coreTableVariantsAtom = atom<CoreTableVariant[]>((get) => {
    const variantsResult = get(variantsAtom)

    if (!variantsResult?.data?.variants) {
        return []
    }

    // Transform API variants to core lightweight table format
    return variantsResult.data.variants.map(transformToCoreTableVariant)
})

// Legacy table variants atom with derived fields (backward compatibility)
export const tableVariantsAtom = atom<TableVariant[]>((get) => {
    const variantsResult = get(variantsAtom)

    if (!variantsResult?.data?.variants) {
        return []
    }

    // Transform API variants to legacy table format with derived fields
    return variantsResult.data.variants.map(transformToTableVariant)
})

// Core table all revisions atom - lightweight format without derived fields
export const coreTableAllRevisionsAtom = atom<CoreTableVariant[]>((get) => {
    const revisionsResult = get(allRevisionsAtom)

    if (!revisionsResult?.data) {
        return []
    }

    // Transform revisions to core lightweight table format
    return revisionsResult.data.map(transformRevisionToCoreTableVariant)
})

// Legacy table all revisions atom with derived fields (backward compatibility)
export const tableAllRevisionsAtom = atom<TableVariant[]>((get) => {
    const revisionsResult = get(allRevisionsAtom)

    if (!revisionsResult?.data) {
        return []
    }

    // Transform revisions to legacy table format with derived fields
    return revisionsResult.data.map(transformRevisionToTableVariant)
})

// Core table latest revisions atom - lightweight format without derived fields
export const coreTableLatestRevisionsAtom = atom<CoreTableVariant[]>((get) => {
    const latestResult = get(latestRevisionsAtom)

    if (!latestResult?.data) {
        return []
    }

    // Transform latest revisions to core lightweight table format
    return latestResult.data.map(transformRevisionToCoreTableVariant)
})

// Legacy table latest revisions atom with derived fields (backward compatibility)
export const tableLatestRevisionsAtom = atom<TableVariant[]>((get) => {
    const latestResult = get(latestRevisionsAtom)

    if (!latestResult?.data) {
        return []
    }

    // Transform latest revisions to legacy table format with derived fields
    return latestResult.data.map(transformRevisionToTableVariant)
})
