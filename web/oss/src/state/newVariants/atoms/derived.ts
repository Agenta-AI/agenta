import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {deepLinkContextAtom} from "./deepLink"
import {variantDeploymentAtomFamily, variantsAtom} from "./queries"
import type {QueryConfig} from "./strategy"
import {windowConfigAtom, windowMetadataAtom} from "./window"

/**
 * Derived State Atoms
 * Pure atoms that compute derived state from queries and configurations
 */

// Table state atom - combines query data with window state
export const variantTableStateAtom = atomFamily((config: QueryConfig & {windowKey: string}) =>
    atom((get) => {
        const {windowKey} = config
        const windowConfig = get(windowConfigAtom(windowKey))
        const windowMetadata = get(windowMetadataAtom(windowKey))
        const deepLink = get(deepLinkContextAtom)
        const variantsResult = get(variantsAtom)

        const queryStatus = {
            isLoading: (variantsResult as any)?.isLoading ?? false,
            isFetching: (variantsResult as any)?.isFetching ?? false,
            isError: (variantsResult as any)?.isError ?? false,
            error: (variantsResult as any)?.error,
            dataUpdatedAt: (variantsResult as any)?.dataUpdatedAt,
            failureCount: (variantsResult as any)?.failureCount ?? 0,
        }

        return {
            // Data
            variants: (variantsResult as any)?.data?.variants || [],
            total: windowConfig.total,

            // Loading states
            isLoading: queryStatus.isLoading,
            isFetching: queryStatus.isFetching,
            isError: queryStatus.isError,
            error: queryStatus.error,

            // Pagination state
            hasMore: windowConfig.hasMore,
            canLoadMore: windowMetadata.canLoadMore,
            currentPage: windowMetadata.currentPage,
            totalPages: windowMetadata.totalPages,
            pageSize: windowMetadata.pageSize,
            startIndex: windowMetadata.startIndex,
            endIndex: windowMetadata.endIndex,
            progress: windowMetadata.progress,

            // Deep link info
            hasPriorityItems: Boolean((variantsResult as any)?.data?.hasPriorityItems),
            priorityCount: (variantsResult as any)?.data?.priorityCount || 0,
            deepLinkedIds: deepLink.priorityIds,

            // Metadata
            lastUpdated: queryStatus.dataUpdatedAt,
            failureCount: queryStatus.failureCount,
        }
    }),
)

// Selection state atom - optimized for dropdowns and selection components
export const variantSelectionStateAtom = atomFamily((appId: string) =>
    atom((get) => {
        const queryResult = get(variantsAtom) as any

        const variants = queryResult?.data?.variants || []
        const isLoading = queryResult?.isLoading

        return {
            variants,
            isLoading,
            isEmpty: !isLoading && variants.length === 0,

            // Pre-computed selection options
            selectableItems: variants.map((v) => ({
                value: v.id,
                label: `${v.name} (v${v.revision})`,
                disabled: v.status === "archived",
                variant: v,
            })),

            // Quick lookup map
            variantMap: variants.reduce(
                (acc: Record<string, any>, v: any) => ({
                    ...acc,
                    [v.id]: v,
                }),
                {} as Record<string, any>,
            ),

            // Grouped by status
            groupedByStatus: variants.reduce(
                (acc: Record<string, any[]>, v: any) => {
                    const status = v.status || "active"
                    if (!acc[status]) acc[status] = []
                    acc[status].push(v)
                    return acc
                },
                {} as Record<string, any[]>,
            ),

            // Statistics
            stats: {
                total: variants.length,
                active: variants.filter((v) => v.status !== "archived").length,
                archived: variants.filter((v) => v.status === "archived").length,
                deployed: variants.filter((v: any) => {
                    const envs = get(
                        variantDeploymentAtomFamily(
                            (v as any).variant_id || (v as any).variantId || (v as any).id,
                        ),
                    ) as string[]
                    return envs.length > 0
                }).length,
            },
        }
    }),
)

// Enhanced variant state atom - for detailed views like playground
export const enhancedVariantStateAtom = atomFamily((appId: string) =>
    atom((get) => {
        const queryResult = get(variantsAtom) as any

        const variants = queryResult?.data?.variants || []
        const isLoading = queryResult?.isLoading

        return {
            variants,
            isLoading,
            isEmpty: !isLoading && variants.length === 0,

            // Enhanced data extractions
            variantsWithRevisions: variants.filter((v) => v.revision && Number(v.revision) > 1),
            variantsWithSchemas: variants.filter((v) => v.schema),
            deployedVariants: variants.filter(
                (v) =>
                    (
                        get(
                            variantDeploymentAtomFamily(
                                (v as any).variant_id || (v as any).variantId || (v as any).id,
                            ),
                        ) as string[]
                    ).length > 0,
            ),

            // Variable extraction (computed once)
            allVariables: variants.reduce((acc: string[], variant: any) => {
                const variables = variant.parameters || {}
                Object.keys(variables).forEach((key) => {
                    if (!acc.includes(key)) acc.push(key)
                })
                return acc
            }, [] as string[]),

            // Revision mapping
            revisionMap: variants.reduce(
                (acc: Record<string, any>, variant: any) => {
                    if (variant.revisions) {
                        variant.revisions.forEach((rev: any) => {
                            acc[rev.id] = {...rev, variant}
                        })
                    }
                    return acc
                },
                {} as Record<string, any>,
            ),

            // Latest revisions
            latestRevisions: variants
                .map((v) => v.revisions?.find((r: any) => r.isLatestRevision))
                .filter(Boolean),

            // Performance metrics
            metrics: {
                totalRevisions: variants.reduce((acc, v) => acc + (v.revisions?.length || 0), 0),
                avgRevisionsPerVariant:
                    variants.length > 0
                        ? variants.reduce((acc, v) => acc + (v.revisions?.length || 0), 0) /
                          variants.length
                        : 0,
                hasSchemaCount: variants.filter((v) => v.schema).length,
                schemaCompleteness:
                    variants.length > 0
                        ? variants.filter((v) => v.schema).length / variants.length
                        : 0,
            },
        }
    }),
)

// Search and filter state atom
export const variantSearchStateAtom = atomFamily(
    (config: {appId: string; searchTerm?: string; filters?: Record<string, any>}) =>
        atom((get) => {
            const {appId, searchTerm = "", filters = {}} = config
            const selectionState = get(variantSelectionStateAtom(appId))

            if (process.env.DEBUG_SEARCH === "true") {
                console.log(
                    `DEBUG: Search atom evaluating - variants count: ${selectionState.variants.length}, loading: ${selectionState.isLoading}`,
                )
                if (selectionState.variants.length > 0) {
                    const sampleVariant = selectionState.variants[0]
                    console.log(
                        `DEBUG: Sample variant - name: ${sampleVariant.variant_name}, revision: ${sampleVariant.revision}`,
                    )
                }
            }

            let filteredVariants = selectionState.variants

            if (process.env.DEBUG_SEARCH === "true") {
                console.log(`DEBUG: Starting with ${filteredVariants.length} variants`)
            }

            // Apply search term
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase().trim()
                const beforeSearch = filteredVariants.length
                filteredVariants = filteredVariants.filter(
                    (variant) =>
                        variant.variant_name?.toLowerCase().includes(term) ||
                        variant.description?.toLowerCase().includes(term) ||
                        variant.variant_id?.toLowerCase().includes(term),
                )
                if (process.env.DEBUG_SEARCH === "true") {
                    console.log(
                        `DEBUG: Search term '${term}' reduced variants from ${beforeSearch} to ${filteredVariants.length}`,
                    )
                }
            }

            // Apply filters
            Object.entries(filters).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== "") {
                    const beforeCount = filteredVariants.length
                    filteredVariants = filteredVariants.filter((variant) => {
                        switch (key) {
                            case "status":
                                return variant.status === value
                            case "deployed": {
                                const envs = get(
                                    variantDeploymentAtomFamily(
                                        (variant as any).variant_id ||
                                            (variant as any).variantId ||
                                            (variant as any).id,
                                    ),
                                ) as string[]
                                return value ? envs.length > 0 : envs.length === 0
                            }
                            case "hasRevisions":
                                const hasRevision = variant.revision && Number(variant.revision) > 1
                                if (process.env.DEBUG_SEARCH === "true") {
                                    console.log(
                                        `DEBUG: Variant ${variant.variant_name} revision=${variant.revision} hasRevision=${hasRevision}`,
                                    )
                                }
                                return value ? hasRevision : !hasRevision
                            default:
                                return variant[key] === value
                        }
                    })
                    if (process.env.DEBUG_SEARCH === "true") {
                        console.log(
                            `DEBUG: Filter ${key}=${value} reduced variants from ${beforeCount} to ${filteredVariants.length}`,
                        )
                    }
                }
            })

            return {
                variants: filteredVariants,
                total: filteredVariants.length,
                isFiltered: searchTerm.trim() !== "" || Object.keys(filters).length > 0,
                searchTerm,
                filters,

                // Search results metadata
                searchResults: {
                    total: filteredVariants.length,
                    percentage:
                        selectionState.variants.length > 0
                            ? (filteredVariants.length / selectionState.variants.length) * 100
                            : 0,
                    isEmpty: filteredVariants.length === 0,
                    hasResults: filteredVariants.length > 0,
                },
            }
        }),
)
