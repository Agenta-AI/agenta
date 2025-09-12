/**
 * Skeleton-Enhanced App Selectors
 *
 * High-level selector atoms that provide skeleton data during loading
 * for immediate UI rendering and better perceived performance
 */

import deepEqual from "fast-deep-equal"
import {selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"

import {hasSkeletonItems} from "../../skeleton/generators"
import {anyAppMutationLoadingAtom} from "../atoms/mutations"
import {
    appsSkeletonAtom,
    appTableSkeletonDataAtom,
    appSelectorSkeletonOptionsAtom,
    currentAppSkeletonAtom,
    appsSkeletonLoadingAtom,
    appsSkeletonErrorAtom,
    appsSkeletonCountAtom,
    appStatsSkeletonAtom,
    hasSkeletonDataAtom,
    appsLoadingProgressAtom,
} from "../atoms/skeleton-queries"

/**
 * Enhanced app table selector with skeleton support
 * Provides immediate rendering with skeleton data
 */
export const appTableSkeletonSelectorAtom = eagerAtom((get) => {
    const data = get(appTableSkeletonDataAtom)
    const loadingState = get(appsSkeletonLoadingAtom)
    const error = get(appsSkeletonErrorAtom)
    const mutationLoading = get(anyAppMutationLoadingAtom)
    const hasSkeletons = hasSkeletonItems(data)

    return {
        data,
        loading: loadingState.isLoading || mutationLoading,
        isSkeleton: loadingState.isSkeleton,
        loadingStage: loadingState.loadingStage,
        progress: get(appsLoadingProgressAtom),
        error,
        isEmpty: !loadingState.isLoading && !error && !hasSkeletons && data.length === 0,
        hasSkeletonItems: hasSkeletons,
    }
})

/**
 * Enhanced app selector state with skeleton support
 */
export const appSelectorSkeletonStateAtom = eagerAtom((get) => {
    const options = get(appSelectorSkeletonOptionsAtom)
    const currentApp = get(currentAppSkeletonAtom)
    const loadingState = get(appsSkeletonLoadingAtom)
    const hasSkeletons = hasSkeletonItems(options)

    // For skeleton state, use first skeleton option as selected
    const selectedId = currentApp?.app_id || (hasSkeletons ? options[0]?.value : null)

    return {
        options,
        selectedId,
        currentApp,
        loading: loadingState.isLoading,
        isSkeleton: loadingState.isSkeleton,
        loadingStage: loadingState.loadingStage,
        hasSelection: !!selectedId,
        hasSkeletonItems: hasSkeletons,
    }
})

/**
 * Enhanced app management actions with skeleton awareness
 */
export const appManagementSkeletonActionsAtom = eagerAtom((get) => {
    const loadingState = get(appsSkeletonLoadingAtom)
    const mutationLoading = get(anyAppMutationLoadingAtom)
    const hasSkeletons = get(hasSkeletonDataAtom)

    return {
        canCreate: !loadingState.isSkeleton && !mutationLoading,
        canDelete: !loadingState.isSkeleton && !mutationLoading,
        canUpdate: !loadingState.isSkeleton && !mutationLoading,
        canSwitch: !hasSkeletons, // Allow switching even during partial loading
        isLoading: loadingState.isLoading || mutationLoading,
        isSkeleton: loadingState.isSkeleton,
        loadingStage: loadingState.loadingStage,
    }
})

/**
 * Enhanced app stats selector with skeleton support
 */
export const appStatsSkeletonSelectorAtom = eagerAtom((get) => {
    const stats = get(appStatsSkeletonAtom)
    const loadingState = get(appsSkeletonLoadingAtom)

    return {
        ...stats,
        isSkeleton: loadingState.isSkeleton,
        loadingStage: loadingState.loadingStage,
        progress: get(appsLoadingProgressAtom),
    }
})

/**
 * Enhanced current app context with skeleton support
 */
export const currentAppSkeletonContextAtom = eagerAtom((get) => {
    const currentApp = get(currentAppSkeletonAtom)
    const loadingState = get(appsSkeletonLoadingAtom)

    return {
        app: currentApp,
        appId: currentApp?.app_id || null,
        appName: currentApp?.app_name || null,
        appType: currentApp?.app_type || null,
        hasApp: !!currentApp,
        loading: loadingState.isLoading,
        isSkeleton: loadingState.isSkeleton,
        loadingStage: loadingState.loadingStage,
    }
})

/**
 * Progressive loading indicator atom
 * Provides detailed loading progress for complex UI states
 */
export const progressiveLoadingAtom = eagerAtom((get) => {
    const loadingState = get(appsSkeletonLoadingAtom)
    const tableData = get(appTableSkeletonDataAtom)
    const selectorOptions = get(appSelectorSkeletonOptionsAtom)
    const stats = get(appStatsSkeletonAtom)

    // Calculate component-level loading states
    const components = {
        table: {
            loaded: !hasSkeletonItems(tableData),
            progress: hasSkeletonItems(tableData) ? 30 : 100,
        },
        selector: {
            loaded: !hasSkeletonItems(selectorOptions),
            progress: hasSkeletonItems(selectorOptions) ? 60 : 100,
        },
        stats: {
            loaded: !stats._skeleton?.isLoading,
            progress: stats._skeleton?.isLoading ? 80 : 100,
        },
    }

    // Calculate overall progress
    const totalProgress =
        Object.values(components).reduce((sum, component) => sum + component.progress, 0) /
        Object.keys(components).length

    return {
        overall: {
            progress: totalProgress,
            isComplete: totalProgress === 100,
            stage: loadingState.loadingStage,
        },
        components,
        isSkeleton: loadingState.isSkeleton,
    }
})

/**
 * Smart refresh atom that handles skeleton states
 */
export const smartRefreshAtom = eagerAtom((get) => {
    const loadingState = get(appsSkeletonLoadingAtom)
    const hasSkeletons = get(hasSkeletonDataAtom)

    return {
        canRefresh: !loadingState.isSkeleton || loadingState.loadingStage === "partial",
        shouldShowRefreshButton: !hasSkeletons,
        refreshInProgress: loadingState.isLoading && loadingState.loadingStage === "initial",
    }
})

/**
 * Export all atoms for easy consumption
 */
export {
    // Core skeleton atoms
    appsSkeletonAtom,
    appTableSkeletonDataAtom,
    appSelectorSkeletonOptionsAtom,
    currentAppSkeletonAtom,
    appsSkeletonLoadingAtom,
    appsSkeletonErrorAtom,
    appsSkeletonCountAtom,
    appStatsSkeletonAtom,
    hasSkeletonDataAtom,
    appsLoadingProgressAtom,
}
