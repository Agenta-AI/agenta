/**
 * Profile Mutation Atoms - User Profile Management Operations
 *
 * This module provides mutation atoms for profile management operations,
 * following the established patterns from newApps, newVariants, newEnvironments, and newOrg.
 */

import {message} from "antd"
import {atom} from "jotai"
import {atomWithMutation, queryClientAtom} from "jotai-tanstack-query"

import {User} from "@/oss/lib/Types"
import {updateProfile, changePassword} from "@/oss/services/profile"

// ============================================================================
// Profile Update Mutation
// ============================================================================

export interface UpdateProfileInput {
    username?: string
    email?: string
    preferences?: Record<string, any>
    avatar?: string
}

/**
 * Update profile mutation atom
 */
export const updateProfileMutationAtom = atomWithMutation<User, UpdateProfileInput>((get) => ({
    mutationFn: async (input: UpdateProfileInput): Promise<User> => {
        const result = await updateProfile(input)
        return result.data as User
    },
    onSuccess: (updatedUser, variables) => {
        const queryClient = get(queryClientAtom)

        // Update profile query cache
        queryClient.setQueryData(["profile"], updatedUser)

        // Invalidate to ensure fresh data
        queryClient.invalidateQueries({
            queryKey: ["profile"],
        })

        message.success("Profile updated successfully")

        console.log("👤 Profile updated:", updatedUser.username || updatedUser.email)
    },
    onError: (error, variables) => {
        console.error("Failed to update profile:", error)
        message.error("Failed to update profile")
    },
}))

// ============================================================================
// Password Change Mutation
// ============================================================================

export interface ChangePasswordInput {
    currentPassword: string
    newPassword: string
    confirmPassword: string
}

/**
 * Change password mutation atom
 */
export const changePasswordMutationAtom = atomWithMutation<void, ChangePasswordInput>((get) => ({
    mutationFn: async (input: ChangePasswordInput): Promise<void> => {
        if (input.newPassword !== input.confirmPassword) {
            throw new Error("New passwords do not match")
        }

        await changePassword({
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
        })
    },
    onSuccess: (_, variables) => {
        message.success("Password changed successfully")
        console.log("👤 Password changed successfully")
    },
    onError: (error, variables) => {
        console.error("Failed to change password:", error)
        const errorMessage = error instanceof Error ? error.message : "Failed to change password"
        message.error(errorMessage)
    },
}))

// ============================================================================
// Profile Preferences Update Mutation
// ============================================================================

export interface UpdatePreferencesInput {
    preferences: Record<string, any>
}

/**
 * Update preferences mutation atom
 */
export const updatePreferencesMutationAtom = atomWithMutation<User, UpdatePreferencesInput>(
    (get) => ({
        mutationFn: async (input: UpdatePreferencesInput): Promise<User> => {
            const result = await updateProfile({
                preferences: input.preferences,
            })
            return result.data as User
        },
        onSuccess: (updatedUser, variables) => {
            const queryClient = get(queryClientAtom)

            // Update profile query cache
            queryClient.setQueryData(["profile"], updatedUser)

            message.success("Preferences updated successfully")

            console.log("👤 Preferences updated")
        },
        onError: (error, variables) => {
            console.error("Failed to update preferences:", error)
            message.error("Failed to update preferences")
        },
    }),
)

// ============================================================================
// Profile Refresh Mutation
// ============================================================================

/**
 * Refresh profile data mutation atom
 */
export const refreshProfileMutationAtom = atom(null, async (get, set) => {
    try {
        const queryClient = get(queryClientAtom)

        // Invalidate profile query to force refresh
        await queryClient.invalidateQueries({
            queryKey: ["profile"],
        })

        message.success("Profile data refreshed")
        console.log("👤 Profile data refreshed")
    } catch (error) {
        console.error("Failed to refresh profile data:", error)
        message.error("Failed to refresh profile data")
    }
})

// ============================================================================
// Profile Utilities
// ============================================================================

/**
 * Profile mutation loading states atom
 */
export const profileMutationLoadingAtom = atom((get) => {
    const updateMutation = get(updateProfileMutationAtom)
    const passwordMutation = get(changePasswordMutationAtom)
    const preferencesMutation = get(updatePreferencesMutationAtom)

    return {
        updatingProfile: updateMutation.isPending,
        changingPassword: passwordMutation.isPending,
        updatingPreferences: preferencesMutation.isPending,
        anyLoading:
            updateMutation.isPending || passwordMutation.isPending || preferencesMutation.isPending,
    }
})

/**
 * Profile mutation errors atom
 */
export const profileMutationErrorsAtom = atom((get) => {
    const updateMutation = get(updateProfileMutationAtom)
    const passwordMutation = get(changePasswordMutationAtom)
    const preferencesMutation = get(updatePreferencesMutationAtom)

    return {
        updateError: updateMutation.error,
        passwordError: passwordMutation.error,
        preferencesError: preferencesMutation.error,
        hasErrors: !!(updateMutation.error || passwordMutation.error || preferencesMutation.error),
    }
})
