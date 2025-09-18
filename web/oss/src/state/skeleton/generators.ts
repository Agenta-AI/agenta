/**
 * Skeleton Data Generators
 *
 * Functions to generate realistic skeleton data for different entity types
 */

import {ListAppsItem} from "@/oss/lib/Types"

import {SkeletonConfig, SkeletonGenerator, SkeletonData, SkeletonMetadata} from "./types"

/**
 * Creates skeleton metadata with default values
 */
export const createSkeletonMetadata = (
    stage: SkeletonMetadata["loadingStage"] = "initial",
    priority: SkeletonMetadata["priority"] = "medium",
): SkeletonMetadata => ({
    isSkeleton: true,
    loadingStage: stage,
    priority,
    timestamp: Date.now(),
})

/**
 * Wraps data with skeleton metadata
 */
export const wrapWithSkeletonMeta = <T>(
    data: T,
    meta?: Partial<SkeletonMetadata>,
): SkeletonData<T> => ({
    data,
    meta: {
        ...createSkeletonMetadata(),
        ...meta,
    },
})

/**
 * Generates realistic skeleton app data
 */
export const createSkeletonApps: SkeletonGenerator<ListAppsItem> = (config = {}) => {
    const {count = 5, realisticValues = true, includeNested = true} = config

    const skeletonApps: ListAppsItem[] = []

    for (let i = 0; i < count; i++) {
        const app: ListAppsItem = {
            app_id: `skeleton-app-${i}`,
            app_name: realisticValues ? `Loading App ${i + 1}...` : "████████",
            app_type: realisticValues ? "custom" : "████",
            updated_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            // Add skeleton-specific properties if needed
            ...(includeNested && {
                // Add nested skeleton data for complex structures
                _skeleton: {
                    isLoading: true,
                    stage: "initial",
                },
            }),
        }
        skeletonApps.push(app)
    }

    return skeletonApps
}

/**
 * Generates skeleton table data with realistic structure
 */
export const createSkeletonTableData = (config: SkeletonConfig = {}) => {
    const apps = createSkeletonApps(config)

    return apps.map((app, index) => ({
        key: app.app_id,
        app_id: app.app_id,
        app_name: app.app_name,
        app_type: app.app_type,
        updated_at: app.updated_at,
        displayName: app.app_name,
        typeTag: app.app_type,
        // Skeleton-specific UI properties
        _skeleton: {
            isLoading: true,
            priority: index < 3 ? "high" : "medium", // First 3 items high priority
        },
    }))
}

/**
 * Generates skeleton selector options
 */
export const createSkeletonSelectorOptions = (config: SkeletonConfig = {}) => {
    const apps = createSkeletonApps(config)

    return apps.map((app) => ({
        value: app.app_id,
        label: app.app_name,
        app_type: app.app_type,
        updated_at: app.updated_at,
        _skeleton: {
            isLoading: true,
        },
    }))
}

/**
 * Generates skeleton app stats
 */
export const createSkeletonAppStats = () => ({
    total: 0,
    byType: {
        custom: 0,
        template: 0,
    },
    recentlyUpdated: createSkeletonApps({count: 3, realisticValues: true}),
    loading: true,
    error: null,
    _skeleton: {
        isLoading: true,
        stage: "initial" as const,
    },
})

/**
 * Utility to check if data is skeleton data
 */
export const isSkeletonData = <T>(data: any): data is SkeletonData<T> => {
    return data && typeof data === "object" && data.meta?.isSkeleton === true
}

/**
 * Utility to extract data from skeleton wrapper
 */
export const extractData = <T>(skeletonData: SkeletonData<T> | T): T => {
    if (isSkeletonData(skeletonData)) {
        return skeletonData.data
    }
    return skeletonData as T
}

/**
 * Utility to check if any item in array has skeleton data
 */
export const hasSkeletonItems = (items: any[]): boolean => {
    return items.some((item) => item._skeleton?.isLoading === true)
}
