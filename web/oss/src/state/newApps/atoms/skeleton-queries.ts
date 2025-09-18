/**
 * Skeleton-Enhanced NewApps Query Atoms
 *
 * Enhanced versions of newApps atoms that provide skeleton data
 * during loading states for better UX and immediate UI rendering
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {ListAppsItem} from "@/oss/lib/Types"
import {selectedProjectIdAtom} from "@/oss/state/app/atoms/app"
import {selectedAppIdAtom as persistedSelectedAppIdAtom} from "@/oss/state/app/atoms/app"

// Skeleton system imports
import {
    createSkeletonApps,
    createSkeletonTableData,
    createSkeletonSelectorOptions,
    createSkeletonAppStats,
    extractData,
    hasSkeletonItems,
} from "../../skeleton/generators"
import {
    atomWithSkeletonQuery,
    skeletonLoadableAtom,
    incrementalLoadingAtom,
    skeletonLoadingStateAtom,
} from "../../skeleton/loadable"
import {SkeletonData} from "../../skeleton/types"
import {listApps} from "../api/apps"

/**
 * Enhanced apps query atom with skeleton data support
 */
export const appsSkeletonQueryAtom = atomWithSkeletonQuery(
    (get) => ({
        queryKey: ["apps", get(selectedProjectIdAtom)],
        queryFn: async () => {
            const projectId = get(selectedProjectIdAtom)
            if (!projectId) return []
            return await listApps()
        },
        enabled: (get) => !!get(selectedProjectIdAtom),
        staleTime: 5 * 60 * 1000, // 5 minutes
        experimental_prefetchInRender: true,
    }),
    createSkeletonApps,
    {
        count: 8, // Show 8 skeleton items initially
        realisticValues: true,
        includeNested: true,
        priority: "high",
    },
)

/**
 * Eager apps atom that provides immediate access to apps data or skeleton
 */
export const appsSkeletonAtom = eagerAtom((get) => {
    const skeletonData = get(appsSkeletonQueryAtom)
    return extractData(skeletonData)
})

/**
 * Enhanced table data atom with skeleton support
 */
export const appTableSkeletonDataAtom = eagerAtom((get) => {
    const skeletonData = get(appsSkeletonQueryAtom)
    const apps = extractData(skeletonData)

    // If we have skeleton data, return skeleton table data
    if (skeletonData.meta.isSkeleton) {
        return createSkeletonTableData({
            count: 8,
            realisticValues: true,
            priority: "high",
        })
    }

    // Transform real data to table format
    return apps.map((app: ListAppsItem, index: number) => ({
        key: app.app_id,
        app_id: app.app_id,
        app_name: app.app_name,
        app_type: app.app_type,
        updated_at: app.updated_at,
        displayName: app.app_name,
        typeTag: app.app_type,
    }))
})

/**
 * Enhanced selector options atom with skeleton support
 */
export const appSelectorSkeletonOptionsAtom = eagerAtom((get) => {
    const skeletonData = get(appsSkeletonQueryAtom)
    const apps = extractData(skeletonData)

    // If we have skeleton data, return skeleton options
    if (skeletonData.meta.isSkeleton) {
        return createSkeletonSelectorOptions({
            count: 5,
            realisticValues: true,
            priority: "high",
        })
    }

    // Transform real data to selector options
    return apps.map((app: ListAppsItem) => ({
        value: app.app_id,
        label: app.app_name,
        app_type: app.app_type,
        updated_at: app.updated_at,
    }))
})

/**
 * Enhanced current app atom with skeleton support
 */
export const currentAppSkeletonAtom = eagerAtom((get) => {
    const selectedId = get(persistedSelectedAppIdAtom)
    const skeletonData = get(appsSkeletonQueryAtom)
    const apps = extractData(skeletonData)

    if (!selectedId) return null

    // If we have skeleton data, return skeleton current app
    if (skeletonData.meta.isSkeleton) {
        const skeletonApps = createSkeletonApps({count: 1, realisticValues: true})
        return skeletonApps[0] || null
    }

    // Find real current app
    return apps.find((app: ListAppsItem) => app.app_id === selectedId) || null
})

/**
 * Enhanced loading state atom
 */
export const appsSkeletonLoadingAtom = skeletonLoadingStateAtom(appsSkeletonQueryAtom)

/**
 * Enhanced error state atom
 */
export const appsSkeletonErrorAtom = selectAtom(
    appsSkeletonQueryAtom,
    (skeletonData) => {
        // Don't show errors during skeleton loading
        if (skeletonData.meta.isSkeleton) return null
        return null // Real error handling would go here
    },
    deepEqual,
)

/**
 * Enhanced count atom
 */
export const appsSkeletonCountAtom = selectAtom(appsSkeletonQueryAtom, (skeletonData) => {
    const apps = extractData(skeletonData)
    return Array.isArray(apps) ? apps.length : 0
})

/**
 * Enhanced app stats atom with skeleton support
 */
export const appStatsSkeletonAtom = eagerAtom((get) => {
    const skeletonData = get(appsSkeletonQueryAtom)
    const apps = extractData(skeletonData)
    const count = get(appsSkeletonCountAtom)

    // If we have skeleton data, return skeleton stats
    if (skeletonData.meta.isSkeleton) {
        return createSkeletonAppStats()
    }

    // Calculate real stats
    const byType = apps.reduce(
        (acc: Record<string, number>, app: any) => {
            const type = app.app_type || "custom"
            acc[type] = (acc[type] || 0) + 1
            return acc
        },
        {} as Record<string, number>,
    )

    // Get recently updated apps (last 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const recentlyUpdated = apps
        .filter((app: any) => new Date(app.updated_at) > sevenDaysAgo)
        .sort(
            (a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        .slice(0, 5)

    return {
        total: count,
        byType,
        recentlyUpdated,
        loading: false,
        error: null,
    }
})

/**
 * Incremental loading atom that combines multiple data sources
 */
export const appsIncrementalAtom = incrementalLoadingAtom(
    appsSkeletonQueryAtom,
    [], // Additional atoms can be added here for nested data
    createSkeletonApps,
    {
        preserveSkeletonStructure: true,
        mergeStrategy: "merge",
    },
)

/**
 * Utility atom to check if any data is still in skeleton state
 */
export const hasSkeletonDataAtom = eagerAtom((get) => {
    const tableData = get(appTableSkeletonDataAtom)
    const selectorOptions = get(appSelectorSkeletonOptionsAtom)

    return hasSkeletonItems(tableData) || hasSkeletonItems(selectorOptions)
})

/**
 * Progress atom for loading indicators
 */
export const appsLoadingProgressAtom = selectAtom(
    appsSkeletonLoadingAtom,
    (loadingState) => loadingState.progress || 0,
)
