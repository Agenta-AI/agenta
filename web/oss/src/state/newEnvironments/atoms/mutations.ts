/**
 * Deployment Mutation Atoms
 *
 * Mutation atoms for deployment operations:
 * - Publish variant to environment
 * - Publish revision to environment
 * - Deployment operation tracking
 * - Success/error handling with analytics
 */

import {message} from "antd"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomWithMutation} from "jotai-tanstack-query"
import posthog from "posthog-js"

import {queryClient} from "@/oss/lib/api/queryClient"
import {createPublishVariant, createPublishRevision} from "@/oss/services/deployment/api"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

// ============================================================================
// Mutation Types
// ============================================================================

export interface PublishVariantPayload {
    variant_id: string
    revision_id?: string
    environment_name: string
    note?: string
    // Metadata for analytics and UI
    variantName?: string
    appId?: string
}

export interface PublishRevisionPayload {
    revision_id: string
    environment_ref: string
    note?: string
    revision_number?: number
    // Metadata for analytics and UI
    variantName?: string
    appId?: string
    deploymentType?: "deploy" | "revert"
}

export interface DeploymentMutationStats {
    totalDeployments: number
    successfulDeployments: number
    failedDeployments: number
    recentDeployments: {
        type: "variant" | "revision"
        environment: string
        variant?: string
        timestamp: Date
        success: boolean
        error?: string
    }[]
}

// ============================================================================
// Mutation Atoms
// ============================================================================

/**
 * Publish variant mutation atom
 * Handles deploying a variant to an environment
 */
export const publishVariantMutationAtom = atomWithMutation<void, PublishVariantPayload>(() => ({
    mutationFn: async (payload: PublishVariantPayload) => {
        const {variantName, appId, ...apiPayload} = payload
        await createPublishVariant(apiPayload)
    },
    onSuccess: (_, payload) => {
        // Invalidate related queries
        queryClient.invalidateQueries({queryKey: ["newEnvironments"]})
        queryClient.invalidateQueries({queryKey: ["environments"]})
        queryClient.invalidateQueries({queryKey: ["variants"]})
        queryClient.invalidateQueries({queryKey: ["newVariants"]})
        queryClient.invalidateQueries({queryKey: ["environmentDeploymentHistory"]})

        // Success message
        const variantDisplay = payload.variantName || "Variant"
        message.success(`Successfully deployed ${variantDisplay} to ${payload.environment_name}`)

        // Analytics
        if (payload.appId) {
            posthog?.capture?.("environment_variant_deployed", {
                app_id: payload.appId,
                environment: payload.environment_name,
                variant_id: payload.variant_id,
                variant_name: payload.variantName,
                has_note: !!payload.note,
            })
        }

        // Update deployment stats
        deploymentStatsTracker.recordDeployment({
            type: "variant",
            environment: payload.environment_name,
            variant: payload.variantName,
            success: true,
        })
    },
    onError: (error, payload) => {
        console.error("Failed to deploy variant:", error)
        message.error(`Failed to deploy to ${payload.environment_name}: ${error.message}`)

        // Analytics for failures
        if (payload.appId) {
            posthog?.capture?.("environment_deployment_failed", {
                app_id: payload.appId,
                environment: payload.environment_name,
                variant_id: payload.variant_id,
                error: error.message,
                deployment_type: "variant",
            })
        }

        // Update deployment stats
        deploymentStatsTracker.recordDeployment({
            type: "variant",
            environment: payload.environment_name,
            variant: payload.variantName,
            success: false,
            error: error.message,
        })
    },
}))

/**
 * Publish revision mutation atom
 * Handles deploying a specific revision to an environment
 */
export const publishRevisionMutationAtom = atomWithMutation<void, PublishRevisionPayload>(() => ({
    mutationFn: async (payload: PublishRevisionPayload) => {
        const {variantName, appId, deploymentType, ...apiPayload} = payload
        await createPublishRevision(apiPayload)
    },
    onSuccess: (_, payload) => {
        // Invalidate related queries
        queryClient.invalidateQueries({queryKey: ["newEnvironments"]})
        queryClient.invalidateQueries({queryKey: ["environments"]})
        queryClient.invalidateQueries({queryKey: ["variants"]})
        queryClient.invalidateQueries({queryKey: ["newVariants"]})
        queryClient.invalidateQueries({queryKey: ["variantRevisions"]})
        queryClient.invalidateQueries({queryKey: ["deploymentRevisions"]})
        queryClient.invalidateQueries({queryKey: ["environmentDeploymentHistory"]})

        // Success message
        const action = payload.deploymentType === "revert" ? "reverted" : "deployed"
        const variantDisplay = payload.variantName || "Revision"
        message.success(`Successfully ${action} ${variantDisplay} to ${payload.environment_ref}`)

        // Analytics
        if (payload.appId) {
            const analyticsEvent =
                payload.deploymentType === "revert"
                    ? "environment_deployment_reverted"
                    : "environment_revision_deployed"

            posthog?.capture?.(analyticsEvent, {
                app_id: payload.appId,
                environment: payload.environment_ref,
                revision_id: payload.revision_id,
                variant_name: payload.variantName,
                revision_number: payload.revision_number,
                has_note: !!payload.note,
            })
        }

        // Update deployment stats
        deploymentStatsTracker.recordDeployment({
            type: "revision",
            environment: payload.environment_ref,
            variant: payload.variantName,
            success: true,
        })
    },
    onError: (error, payload) => {
        console.error("Failed to deploy revision:", error)
        const action = payload.deploymentType === "revert" ? "revert" : "deploy"
        message.error(`Failed to ${action} to ${payload.environment_ref}: ${error.message}`)

        // Analytics for failures
        if (payload.appId) {
            posthog?.capture?.("environment_deployment_failed", {
                app_id: payload.appId,
                environment: payload.environment_ref,
                revision_id: payload.revision_id,
                error: error.message,
                deployment_type: "revision",
            })
        }

        // Update deployment stats
        deploymentStatsTracker.recordDeployment({
            type: "revision",
            environment: payload.environment_ref,
            variant: payload.variantName,
            success: false,
            error: error.message,
        })
    },
}))

// ============================================================================
// Deployment Stats Tracking
// ============================================================================

/**
 * In-memory deployment stats tracker
 */
class DeploymentStatsTracker {
    private stats: DeploymentMutationStats = {
        totalDeployments: 0,
        successfulDeployments: 0,
        failedDeployments: 0,
        recentDeployments: [],
    }

    recordDeployment(deployment: {
        type: "variant" | "revision"
        environment: string
        variant?: string
        success: boolean
        error?: string
    }) {
        this.stats.totalDeployments++

        if (deployment.success) {
            this.stats.successfulDeployments++
        } else {
            this.stats.failedDeployments++
        }

        // Add to recent deployments (keep last 20)
        this.stats.recentDeployments.unshift({
            ...deployment,
            timestamp: new Date(),
        })

        if (this.stats.recentDeployments.length > 20) {
            this.stats.recentDeployments = this.stats.recentDeployments.slice(0, 20)
        }
    }

    getStats(): DeploymentMutationStats {
        return {...this.stats}
    }

    reset() {
        this.stats = {
            totalDeployments: 0,
            successfulDeployments: 0,
            failedDeployments: 0,
            recentDeployments: [],
        }
    }
}

const deploymentStatsTracker = new DeploymentStatsTracker()

/**
 * Deployment mutation statistics atom
 */
export const deploymentMutationStatsAtom = atom<DeploymentMutationStats>(() =>
    deploymentStatsTracker.getStats(),
)

// ============================================================================
// Mutation State Atoms
// ============================================================================

/**
 * Combined mutation loading state
 */
export const deploymentMutationLoadingAtom = atom((get) => {
    const variantMutation = get(publishVariantMutationAtom)
    const revisionMutation = get(publishRevisionMutationAtom)

    return (variantMutation as any)?.isPending || (revisionMutation as any)?.isPending || false
})

/**
 * Combined mutation error state
 */
export const deploymentMutationErrorAtom = atom((get) => {
    const variantMutation = get(publishVariantMutationAtom)
    const revisionMutation = get(publishRevisionMutationAtom)

    const variantError = (variantMutation as any)?.error
    const revisionError = (revisionMutation as any)?.error

    return variantError || revisionError || null
})

/**
 * Deployment operation status atom
 */
export const deploymentOperationStatusAtom = selectAtom(
    atom((get) => ({
        loading: get(deploymentMutationLoadingAtom),
        error: get(deploymentMutationErrorAtom),
        stats: get(deploymentMutationStatsAtom),
    })),
    ({loading, error, stats}) => ({
        isDeploying: loading,
        hasError: !!error,
        errorMessage: error?.message || null,
        successRate:
            stats.totalDeployments > 0
                ? (stats.successfulDeployments / stats.totalDeployments) * 100
                : 0,
        totalOperations: stats.totalDeployments,
        recentActivity: stats.recentDeployments.slice(0, 5),
        canDeploy: !loading,
    }),
)

/**
 * Reset deployment stats atom (write-only)
 */
export const resetDeploymentStatsAtom = atom(null, () => {
    deploymentStatsTracker.reset()
})

// ============================================================================
// Convenience Mutation Helpers
// ============================================================================

/**
 * Quick deploy variant atom (with app context)
 */
export const quickDeployVariantAtom = atom(
    null,
    (get, set, payload: Omit<PublishVariantPayload, "appId">) => {
        const appId = get(selectedAppIdAtom)
        const variantMutation = get(publishVariantMutationAtom)

        if (!appId) {
            message.error("No app selected for deployment")
            return
        }

        const fullPayload: PublishVariantPayload = {
            ...payload,
            appId,
        }

        ;(variantMutation as any).mutate(fullPayload)
    },
)

/**
 * Quick deploy revision atom (with app context)
 */
export const quickDeployRevisionAtom = atom(
    null,
    (get, set, payload: Omit<PublishRevisionPayload, "appId">) => {
        const appId = get(selectedAppIdAtom)
        const revisionMutation = get(publishRevisionMutationAtom)

        if (!appId) {
            message.error("No app selected for deployment")
            return
        }

        const fullPayload: PublishRevisionPayload = {
            ...payload,
            appId,
        }

        ;(revisionMutation as any).mutate(fullPayload)
    },
)
