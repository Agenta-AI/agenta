/**
 * New Apps Selector Atoms
 *
 * High-level selector atoms that combine query and mutation atoms
 * for common app management use cases:
 * - App table data with loading states
 * - App selector with current selection
 * - App management actions
 */

import {atom} from "jotai"
import {eagerAtom} from "jotai-eager"

import {ListAppsItem} from "@/oss/lib/Types"

import {
    createAppMutationAtom,
    deleteAppMutationAtom,
    updateAppMutationAtom,
    switchAppMutationAtom,
    anyAppMutationLoadingAtom,
} from "../atoms/mutations"
import {
    appsAtom,
    appsQueryAtom,
    appTableDataAtom,
    appSelectorOptionsAtom,
    currentAppAtom,
    selectedAppIdAtom,
    appsLoadingAtom,
    appsErrorAtom,
    appsCountAtom,
} from "../atoms/queries"

/**
 * App table selector - combines data and loading states
 * Used by: AppTable component
 */
export const appTableSelectorAtom = eagerAtom((get) => {
    const data = get(appTableDataAtom)
    const loading = get(appsLoadingAtom)
    const error = get(appsErrorAtom)
    const mutationLoading = get(anyAppMutationLoadingAtom)

    return {
        data,
        loading: loading || mutationLoading,
        error,
        isEmpty: !loading && !error && Array.isArray(data) && data.length === 0,
    }
})

/**
 * App selector state - combines options and current selection
 * Used by: App selector dropdown
 */
export const appSelectorStateAtom = eagerAtom((get) => {
    const options = get(appSelectorOptionsAtom)
    const selectedId = get(selectedAppIdAtom)
    const currentApp = get(currentAppAtom)
    const loading = get(appsLoadingAtom)

    return {
        options,
        selectedId,
        currentApp,
        loading,
        hasSelection: !!selectedId,
    }
})

/**
 * App management actions - combines all mutation atoms
 * Used by: App management components
 */
export const appManagementActionsAtom = atom((get) => {
    const createMutation = get(createAppMutationAtom)
    const deleteMutation = get(deleteAppMutationAtom)
    const updateMutation = get(updateAppMutationAtom)
    const switchAction = get(switchAppMutationAtom)

    return {
        createApp: createMutation.mutate,
        deleteApp: deleteMutation.mutate,
        updateApp: updateMutation.mutate,
        switchApp: (appId: string | null) => switchAction,

        // Loading states
        isCreating: createMutation.isPending,
        isDeleting: deleteMutation.isPending,
        isUpdating: updateMutation.isPending,

        // Error states
        createError: createMutation.error,
        deleteError: deleteMutation.error,
        updateError: updateMutation.error,

        // Success states
        createSuccess: createMutation.isSuccess,
        deleteSuccess: deleteMutation.isSuccess,
        updateSuccess: updateMutation.isSuccess,
    }
})

/**
 * App stats selector - for dashboard/overview
 * Used by: Dashboard, app management overview
 */
export const appStatsAtom = eagerAtom((get) => {
    const apps = get(appsAtom)
    const count = get(appsCountAtom)
    const loading = get(appsLoadingAtom)
    const error = get(appsErrorAtom)

    if (loading || error || !apps || apps.length === 0) {
        return {
            total: 0,
            byType: {},
            recentlyUpdated: [],
            loading,
            error,
        }
    }

    // Calculate stats
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
        .slice(0, 5) // Top 5 most recent

    return {
        total: count,
        byType,
        recentlyUpdated,
        loading: false,
        error: null,
    }
})

/**
 * Current app context - provides full context for current app
 * Used by: Components that need current app info
 */
export const currentAppContextAtom = eagerAtom((get) => {
    const currentApp = get(currentAppAtom)
    const selectedId = get(selectedAppIdAtom)
    const loading = get(appsLoadingAtom)

    return {
        app: currentApp,
        appId: selectedId,
        appName: currentApp?.app_name || null,
        appType: currentApp?.app_type || null,
        hasApp: !!currentApp,
        loading,
    }
})

/**
 * Re-export commonly used atoms for convenience
 */
export {
    // Query atoms
    appsAtom,
    appsQueryAtom,
    currentAppAtom,
    selectedAppIdAtom,
    appsLoadingAtom,
    appsErrorAtom,

    // Mutation atoms
    createAppMutationAtom,
    deleteAppMutationAtom,
    updateAppMutationAtom,
    switchAppMutationAtom,
}
