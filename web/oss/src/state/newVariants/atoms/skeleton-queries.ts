/**
 * Skeleton-Enhanced NewVariants Atoms
 *
 * Provides skeleton-aware versions of variant and revision atoms with support for:
 * - Nested skeleton states (deployedIn, parent variants)
 * - Progressive loading of derived data
 * - Smart skeleton detection for table optimization
 * - Backward compatibility with existing atoms
 */

import {atomFamily} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import type {VariantRevision} from "@/oss/lib/Types"
import {
    createSkeletonTableData,
    extractData,
    wrapWithSkeletonMeta,
} from "@/oss/state/skeleton/generators"

import {fetchAppVariants, fetchAllRevisions, variantToRevision} from "../api/variants"

import {
    CoreTableVariant,
    TableVariant,
    transformToCoreTableVariant,
    transformToTableVariant,
    transformRevisionToCoreTableVariant,
} from "./queries"

// Environment variables for configuration
const appId = process.env.VITEST_TEST_APP_ID || ""

// Skeleton-enhanced query atoms with meta information
export const variantsSkeletonQueryAtom = atomWithQuery(() => ({
    queryKey: ["variants", appId, "skeleton"],
    queryFn: async () => {
        const data = await fetchAppVariants(appId)
        return wrapWithSkeletonMeta(data, {
            loadingStage: "complete",
            hasNestedLoading: false,
        })
    },
    enabled: !!appId,
    staleTime: 30000,
    gcTime: 300000,
}))

export const allRevisionsSkeletonQueryAtom = atomWithQuery(() => ({
    queryKey: ["allRevisions", appId, "skeleton"],
    queryFn: async () => {
        const data = await fetchAllRevisions(appId)
        return wrapWithSkeletonMeta(data, {
            loadingStage: "complete",
            hasNestedLoading: true, // deployedIn data may still be loading
        })
    },
    enabled: !!appId,
    staleTime: 60000,
    gcTime: 600000,
}))

// Skeleton-enhanced atoms with eager evaluation
export const variantsSkeletonAtom = eagerAtom((get) => {
    const skeletonData = get(variantsSkeletonQueryAtom)
    return extractData(skeletonData)
})

export const allRevisionsSkeletonAtom = eagerAtom((get) => {
    const skeletonData = get(allRevisionsSkeletonQueryAtom)
    return extractData(skeletonData)
})

// Latest revisions with skeleton support - derived from variants
export const latestRevisionsSkeletonAtom = eagerAtom((get) => {
    const variantsSkeletonData = get(variantsSkeletonQueryAtom)
    const variants = extractData(variantsSkeletonData)

    if (variantsSkeletonData.meta.isSkeleton) {
        // Return skeleton revisions with realistic data
        return wrapWithSkeletonMeta(
            Array.from({length: 5}, (_, i) => ({
                id: `skeleton-revision-${i}`,
                variantId: `skeleton-variant-${i}`,
                variantName: `Loading Variant ${i + 1}`,
                revision: i + 1,
                config: {
                    configName: `Loading Configuration...`,
                    parameters: {},
                },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                modifiedBy: "Loading...",
                commitMessage: "████████████",
                isLatestRevision: i === 0,
                deployedIn: [{name: "Loading Environment...", _skeleton: {isLoading: true}}],
                _skeleton: {isLoading: true},
            })),
            {
                loadingStage: "partial",
                hasNestedLoading: true,
            },
        )
    }

    if (!variants?.data?.variants) {
        return {isLoading: variants?.isLoading, isError: variants?.isError, data: []}
    }

    // Transform variants to revisions and get latest 5
    const latestRevisions = variants.data.variants
        .map((variant: any) => variantToRevision(variant))
        .sort((a: any, b: any) => b.updatedAtTimestamp - a.updatedAtTimestamp)
        .slice(0, 5)

    return wrapWithSkeletonMeta(latestRevisions, {
        loadingStage: "complete",
        hasNestedLoading: false,
    })
})

// Skeleton-enhanced table atoms with nested skeleton support

// Core table variants with skeleton support
export const coreTableVariantsSkeletonAtom = eagerAtom((get) => {
    const variantsSkeletonData = get(variantsSkeletonQueryAtom)
    const variants = extractData(variantsSkeletonData)

    if (variantsSkeletonData.meta.isSkeleton) {
        return createSkeletonTableData({
            count: 8,
            realisticValues: true,
            priority: "high",
            customFields: {
                variantName: () => `Loading Variant...`,
                revision: () => Math.floor(Math.random() * 10) + 1,
                parameters: () => ({loading: true}),
                isLatestRevision: () => Math.random() > 0.5,
                uri: () => undefined,
            },
        }) as CoreTableVariant[]
    }

    if (!variants?.data?.variants) {
        return []
    }

    return variants.data.variants.map(transformToCoreTableVariant)
})

// Legacy table variants with skeleton support and nested data
export const tableVariantsSkeletonAtom = eagerAtom((get) => {
    const variantsSkeletonData = get(variantsSkeletonQueryAtom)
    const variants = extractData(variantsSkeletonData)

    if (variantsSkeletonData.meta.isSkeleton) {
        const skeletonData = createSkeletonTableData({
            count: 8,
            realisticValues: true,
            priority: "high",
            customFields: {
                variantName: () => `Loading Variant...`,
                revision: () => Math.floor(Math.random() * 10) + 1,
                parameters: () => ({loading: true}),
                isLatestRevision: () => Math.random() > 0.5,
                uri: () => undefined,
                // Nested skeleton data for deployedIn
                deployedIn: () => ["Loading Environment...", "████████████"],
                _parentVariant: () => ({
                    id: "skeleton-parent",
                    name: "Loading Parent...",
                    variantName: "Loading Parent Variant...",
                    variantId: "skeleton-parent-id",
                    revision: 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: {name: "Loading..."},
                }),
            },
        }) as TableVariant[]

        return skeletonData
    }

    if (!variants?.data?.variants) {
        return []
    }

    return variants.data.variants.map(transformToTableVariant)
})

// Core table all revisions with skeleton support
export const coreTableAllRevisionsSkeletonAtom = eagerAtom((get) => {
    const revisionsSkeletonData = get(allRevisionsSkeletonQueryAtom)
    const revisions = extractData(revisionsSkeletonData)

    if (revisionsSkeletonData.meta.isSkeleton) {
        return createSkeletonTableData({
            count: 15,
            realisticValues: true,
            priority: "medium",
            customFields: {
                variantName: () => `Loading Revision...`,
                revision: () => Math.floor(Math.random() * 20) + 1,
                parameters: () => ({loading: true}),
                commitMessage: () => "Loading commit message...",
                isLatestRevision: () => Math.random() > 0.8,
                uri: () => undefined,
            },
        }) as CoreTableVariant[]
    }

    if (!revisions?.data) {
        return []
    }

    return revisions.data.map(transformRevisionToCoreTableVariant)
})

// Legacy table all revisions with skeleton support and nested data
export const tableAllRevisionsSkeletonAtom = eagerAtom((get) => {
    const revisionsSkeletonData = get(allRevisionsSkeletonQueryAtom)
    const revisions = extractData(revisionsSkeletonData)

    if (revisionsSkeletonData.meta.isSkeleton) {
        const skeletonData = createSkeletonTableData({
            count: 15,
            realisticValues: true,
            priority: "medium",
            customFields: {
                variantName: () => `Loading Revision...`,
                revision: () => Math.floor(Math.random() * 20) + 1,
                parameters: () => ({loading: true}),
                commitMessage: () => "Loading commit message...",
                isLatestRevision: () => Math.random() > 0.8,
                uri: () => undefined,
                // Nested skeleton data for deployedIn - showing progressive loading
                deployedIn: () => {
                    const envCount = Math.floor(Math.random() * 3) + 1
                    return Array.from({length: envCount}, (_, i) =>
                        i === 0 ? "production" : `Loading Environment ${i}...`,
                    )
                },
                _parentVariant: () => ({
                    id: "skeleton-parent",
                    name: "Loading Parent...",
                    variantName: "Loading Parent Variant...",
                    variantId: "skeleton-parent-id",
                    revision: Math.floor(Math.random() * 10) + 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: {name: "Loading..."},
                }),
            },
        }) as TableVariant[]

        return skeletonData
    }

    if (!revisions?.data) {
        return []
    }

    // Transform revisions to legacy table format with derived fields
    return revisions.data.map((revision: VariantRevision) => {
        const core = transformRevisionToCoreTableVariant(revision)
        return {
            ...core,
            // Deployment info is derived elsewhere; avoid reading from revision object
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
    })
})

// Core table latest revisions with skeleton support
export const coreTableLatestRevisionsSkeletonAtom = eagerAtom((get) => {
    const latestSkeletonData = get(latestRevisionsSkeletonAtom)
    const latest = extractData(latestSkeletonData)

    if (latestSkeletonData.meta.isSkeleton) {
        return createSkeletonTableData({
            count: 5,
            realisticValues: true,
            priority: "high",
            customFields: {
                variantName: () => `Loading Latest...`,
                revision: () => Math.floor(Math.random() * 5) + 1,
                parameters: () => ({loading: true}),
                commitMessage: () => "Loading latest commit...",
                isLatestRevision: () => true,
                uri: () => undefined,
            },
        }) as CoreTableVariant[]
    }

    if (!latest?.data) {
        return []
    }

    return latest.data.map(transformRevisionToCoreTableVariant)
})

// Legacy table latest revisions with skeleton support and nested data
export const tableLatestRevisionsSkeletonAtom = eagerAtom((get) => {
    const latestSkeletonData = get(latestRevisionsSkeletonAtom)
    const latest = extractData(latestSkeletonData)

    if (latestSkeletonData.meta.isSkeleton) {
        const skeletonData = createSkeletonTableData({
            count: 5,
            realisticValues: true,
            priority: "high",
            customFields: {
                variantName: () => `Loading Latest...`,
                revision: () => Math.floor(Math.random() * 5) + 1,
                parameters: () => ({loading: true}),
                commitMessage: () => "Loading latest commit...",
                isLatestRevision: () => true,
                uri: () => undefined,
                // Nested skeleton data showing mixed loading states
                deployedIn: () => {
                    const states = [
                        ["production", "Loading staging..."],
                        ["Loading production...", "████████████"],
                        ["production", "staging", "Loading dev..."],
                    ]
                    return states[Math.floor(Math.random() * states.length)]
                },
                _parentVariant: () => ({
                    id: "skeleton-latest-parent",
                    name: "Loading Latest Parent...",
                    variantName: "Loading Latest Variant...",
                    variantId: "skeleton-latest-parent-id",
                    revision: 1,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    createdBy: {name: "Loading..."},
                }),
            },
        }) as TableVariant[]

        return skeletonData
    }

    if (!latest?.data) {
        return []
    }

    // Transform latest revisions to legacy table format with derived fields
    return latest.data.map((revision: VariantRevision) => {
        const core = transformRevisionToCoreTableVariant(revision)
        return {
            ...core,
            // Deployment info is derived elsewhere; avoid reading from revision object
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
    })
})

// Skeleton-enhanced derived atoms for nested data

// Variant deployment atom family with skeleton support for nested loading
export const variantDeploymentSkeletonAtomFamily = atomFamily((variantId: string) =>
    eagerAtom((get) => {
        const allRevisionsSkeletonData = get(allRevisionsSkeletonQueryAtom)
        const allRevisions = extractData(allRevisionsSkeletonData)

        // Handle skeleton state with progressive loading simulation
        if (allRevisionsSkeletonData.meta.isSkeleton) {
            // Simulate partial deployment data loading
            const skeletonDeployments = [
                "production", // Already loaded
                "Loading staging...", // Still loading
                "████████████", // Placeholder
            ]
            return skeletonDeployments.slice(0, Math.floor(Math.random() * 3) + 1)
        }

        if (allRevisions.status !== "success") {
            return []
        }

        // Find all revisions for this variant and aggregate their deployments
        const variantRevisions = allRevisions.data.filter(
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

// Variant parent atom family with skeleton support
export const variantParentSkeletonAtomFamily = atomFamily((variantId: string) =>
    eagerAtom((get) => {
        const variantsSkeletonData = get(variantsSkeletonQueryAtom)
        const allRevisionsSkeletonData = get(allRevisionsSkeletonQueryAtom)

        const variants = extractData(variantsSkeletonData)
        const allRevisions = extractData(allRevisionsSkeletonData)

        // Handle skeleton state
        if (variantsSkeletonData.meta.isSkeleton || allRevisionsSkeletonData.meta.isSkeleton) {
            return {
                id: `skeleton-parent-${variantId}`,
                name: "Loading Parent Variant...",
                variantName: "Loading Parent...",
                variantId: `skeleton-parent-${variantId}`,
                revision: Math.floor(Math.random() * 10) + 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                createdBy: {name: "Loading..."},
            }
        }

        // First check variants data
        if (variants?.data?.variants) {
            const variant = variants.data.variants.find(
                (v: any) => v.variant_id === variantId || v.variantId === variantId,
            )
            if (variant) {
                return {
                    id: variant.variant_id || variant.variantId,
                    name: variant.variant_name || variant.variantName,
                    variantName: variant.variant_name || variant.variantName,
                    variantId: variant.variant_id || variant.variantId,
                    revision: variant.revision || 1,
                    createdAt: variant.created_at,
                    updatedAt: variant.updated_at,
                    createdBy: variant.modified_by_id,
                }
            }
        }

        // Then check revisions data
        if (allRevisions?.data) {
            const revision = allRevisions.data.find((r) => r.variantId === variantId)
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

// Skeleton-enhanced app status atoms
export const revisionCentricAppStatusSkeletonAtom = eagerAtom((get) => {
    const variantsSkeletonData = get(variantsSkeletonQueryAtom)
    const variants = extractData(variantsSkeletonData)

    // During skeleton loading, assume playground might be available
    if (variantsSkeletonData.meta.isSkeleton) {
        return true // Optimistic loading state
    }

    if (!variants?.data?.variants) {
        return false
    }

    // Check if any variant has a URI
    return variants.data.variants.some((variant: any) => variant.uri && variant.uri.trim() !== "")
})

// Per-variant app status atom family with skeleton support
export const revisionCentricVariantAppStatusSkeletonAtomFamily = atomFamily((variantId: string) =>
    eagerAtom((get) => {
        const variantsSkeletonData = get(variantsSkeletonQueryAtom)
        const variants = extractData(variantsSkeletonData)

        // During skeleton loading, assume playground might be available
        if (variantsSkeletonData.meta.isSkeleton) {
            return Math.random() > 0.5 // Random optimistic state for skeleton
        }

        if (!variants?.data?.variants) {
            return false
        }

        // Find the specific variant and check if it has a URI
        const variant = variants.data.variants.find(
            (v: any) => v.variant_id === variantId || v.variantId === variantId,
        )

        return variant ? variant.uri && variant.uri.trim() !== "" : false
    }),
)
