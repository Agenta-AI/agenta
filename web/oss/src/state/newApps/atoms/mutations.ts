/**
 * New Apps Mutation Atoms
 *
 * Optimized Jotai atoms for app mutations with:
 * - React Query mutations via jotai-tanstack-query
 * - Automatic cache invalidation
 * - Optimistic updates where appropriate
 * - Error handling and loading states
 */

import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithMutation} from "jotai-tanstack-query"

import {createApp, deleteApp, updateApp, CreateAppRequest, UpdateAppRequest} from "../api/apps"

import {selectedAppIdAtom} from "./queries"

/**
 * Create app mutation
 * Used by: Create app modal, template creation
 */
export const createAppMutationAtom = atomWithMutation(() => ({
    mutationFn: async (request: CreateAppRequest) => {
        return createApp(request)
    },
    onSuccess: (data, variables, context) => {
        // Invalidate apps list to refetch with new app
        const queryClient = context?.queryClient
        if (queryClient) {
            queryClient.invalidateQueries({queryKey: ["apps"]})
        }

        console.log("✅ App created successfully:", data.app_name)
    },
    onError: (error) => {
        console.error("❌ Failed to create app:", error)
    },
}))

/**
 * Delete app mutation
 * Used by: Delete app modal
 */
export const deleteAppMutationAtom = atomWithMutation((get) => ({
    mutationFn: async (appId: string) => {
        await deleteApp(appId)
        return appId
    },
    onSuccess: (deletedAppId, variables, context) => {
        // Invalidate apps list to refetch without deleted app
        const queryClient = context?.queryClient
        if (queryClient) {
            queryClient.invalidateQueries({queryKey: ["apps"]})
        }

        // Clear selection if deleted app was selected
        const selectedId = get(selectedAppIdAtom)
        if (selectedId === deletedAppId) {
            // Note: This will be handled by the component using the mutation
        }

        console.log("✅ App deleted successfully:", deletedAppId)
    },
    onError: (error) => {
        console.error("❌ Failed to delete app:", error)
    },
}))

/**
 * Update app mutation
 * Used by: Edit app modal
 */
export const updateAppMutationAtom = atomWithMutation(() => ({
    mutationFn: async ({appId, request}: {appId: string; request: UpdateAppRequest}) => {
        return updateApp(appId, request)
    },
    onSuccess: (data, variables, context) => {
        // Invalidate apps list to refetch with updated app
        const queryClient = context?.queryClient
        if (queryClient) {
            queryClient.invalidateQueries({queryKey: ["apps"]})
        }

        console.log("✅ App updated successfully:", data.app_name)
    },
    onError: (error) => {
        console.error("❌ Failed to update app:", error)
    },
}))

/**
 * Switch app mutation (for app selection)
 * Used by: App selector, navigation
 */
export const switchAppMutationAtom = atom(null, (get, set, appId: string | null) => {
    // Update selected app ID
    set(selectedAppIdAtom, appId)

    // Log the switch for debugging
    if (appId) {
        console.log("🔄 Switched to app:", appId)
    } else {
        console.log("🔄 Cleared app selection")
    }

    // Return success indicator
    return Promise.resolve({success: true, appId})
})

/**
 * Mutation loading states for UI feedback - using selectAtom for performance
 */
export const createAppLoadingAtom = selectAtom(
    createAppMutationAtom,
    (mutation) => mutation.isPending,
)
export const deleteAppLoadingAtom = selectAtom(
    deleteAppMutationAtom,
    (mutation) => mutation.isPending,
)
export const updateAppLoadingAtom = selectAtom(
    updateAppMutationAtom,
    (mutation) => mutation.isPending,
)

/**
 * Combined loading state for any app operation - eager evaluation
 */
export const anyAppMutationLoadingAtom = eagerAtom((get) => {
    return get(createAppLoadingAtom) || get(deleteAppLoadingAtom) || get(updateAppLoadingAtom)
})

/**
 * Mutation error states - using selectAtom for performance
 */
export const createAppErrorAtom = selectAtom(createAppMutationAtom, (mutation) => mutation.error)
export const deleteAppErrorAtom = selectAtom(deleteAppMutationAtom, (mutation) => mutation.error)
export const updateAppErrorAtom = selectAtom(updateAppMutationAtom, (mutation) => mutation.error)

/**
 * Mutation success states - using selectAtom for performance
 */
export const createAppSuccessAtom = selectAtom(
    createAppMutationAtom,
    (mutation) => mutation.isSuccess,
)
export const deleteAppSuccessAtom = selectAtom(
    deleteAppMutationAtom,
    (mutation) => mutation.isSuccess,
)
export const updateAppSuccessAtom = selectAtom(
    updateAppMutationAtom,
    (mutation) => mutation.isSuccess,
)
