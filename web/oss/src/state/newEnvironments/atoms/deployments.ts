/**
 * Deployment Status and History Atoms
 *
 * Specialized atoms for deployment tracking:
 * - Active deployment status per environment
 * - Deployment history and versioning
 * - Deployment statistics and analytics
 * - Cross-environment deployment insights
 */

import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

// import {Environment} from "@/oss/lib/Types" // Will be used in future iterations
import {fetchAllDeploymentRevisions} from "@/oss/services/deploymentVersioning/api"
import {DeploymentRevisions} from "@/oss/services/deploymentVersioning/types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {projectIdAtom} from "@/oss/state/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"

import {environmentsAtom, environmentsLoadingAtom} from "./environments"

// ============================================================================
// Deployment Types
// ============================================================================

export interface EnvironmentDeploymentStatus {
    environmentName: string
    isDeployed: boolean
    deployedVariantId: string | null
    deployedVariantName: string | null
    deployedRevisionId: string | null
    revision: string | null
    lastDeploymentTime: string | null
    deploymentHealth: "healthy" | "unknown" | "error"
}

export interface DeploymentStats {
    totalEnvironments: number
    deployedEnvironments: number
    emptyEnvironments: number
    deploymentRate: number
    uniqueVariantsDeployed: number
    mostDeployedVariant: string | null
    recentDeployments: number
}

export interface ActiveDeployment {
    environmentName: string
    variantId: string
    variantName: string
    revisionId: string | null
    revision: string | null
    deployedAt: string | null
}

// ============================================================================
// Deployment Status Atoms
// ============================================================================

/**
 * Environment deployment status atom
 * Transforms environments into deployment-focused data
 */
export const environmentDeploymentStatusAtom = selectAtom(
    environmentsAtom,
    (environments): EnvironmentDeploymentStatus[] =>
        environments.map((env) => ({
            environmentName: env.name,
            isDeployed: !!(env.deployed_app_variant_id && env.deployed_variant_name),
            deployedVariantId: env.deployed_app_variant_id,
            deployedVariantName: env.deployed_variant_name,
            deployedRevisionId: env.deployed_app_variant_revision_id,
            revision: env.revision,
            lastDeploymentTime: env.revision, // Using revision as proxy for deployment time
            deploymentHealth: env.deployed_app_variant_id ? "healthy" : "unknown",
        })),
    deepEqual,
)

/**
 * Active deployments by environment atom
 */
export const activeDeploymentsByEnvironmentAtom = selectAtom(
    environmentDeploymentStatusAtom,
    (statuses): Record<string, ActiveDeployment | null> => {
        const deployments: Record<string, ActiveDeployment | null> = {}

        statuses.forEach((status) => {
            if (status.isDeployed && status.deployedVariantId && status.deployedVariantName) {
                deployments[status.environmentName] = {
                    environmentName: status.environmentName,
                    variantId: status.deployedVariantId,
                    variantName: status.deployedVariantName,
                    revisionId: status.deployedRevisionId,
                    revision: status.revision,
                    deployedAt: status.lastDeploymentTime,
                }
            } else {
                deployments[status.environmentName] = null
            }
        })

        return deployments
    },
    deepEqual,
)

/**
 * Deployment statistics atom
 */
export const deploymentStatsAtom = selectAtom(
    environmentDeploymentStatusAtom,
    (statuses): DeploymentStats => {
        const totalEnvironments = statuses.length
        const deployedEnvironments = statuses.filter((s) => s.isDeployed).length
        const emptyEnvironments = totalEnvironments - deployedEnvironments

        // Count unique variants deployed
        const uniqueVariants = new Set(
            statuses.filter((s) => s.deployedVariantName).map((s) => s.deployedVariantName!),
        )

        // Find most deployed variant
        const variantCounts: Record<string, number> = {}
        statuses.forEach((status) => {
            if (status.deployedVariantName) {
                variantCounts[status.deployedVariantName] =
                    (variantCounts[status.deployedVariantName] || 0) + 1
            }
        })

        const mostDeployedVariant =
            Object.entries(variantCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null

        return {
            totalEnvironments,
            deployedEnvironments,
            emptyEnvironments,
            deploymentRate:
                totalEnvironments > 0 ? (deployedEnvironments / totalEnvironments) * 100 : 0,
            uniqueVariantsDeployed: uniqueVariants.size,
            mostDeployedVariant,
            recentDeployments: deployedEnvironments, // Simplified for now
        }
    },
    deepEqual,
)

// ============================================================================
// Deployment History Atoms
// ============================================================================

/**
 * Deployment history query atom family (per environment)
 */
export const environmentDeploymentHistoryQueryAtomFamily = atomFamily((environmentName: string) =>
    atomWithQuery<DeploymentRevisions | undefined>((get) => {
        const appId = get(selectedAppIdAtom)
        const projectId = get(projectIdAtom)
        const jwtReady = get(jwtReadyAtom).data ?? false

        const enabled = !!appId && !!environmentName && !!projectId && jwtReady

        return {
            queryKey: ["environmentDeploymentHistory", appId, environmentName],
            queryFn: async (): Promise<DeploymentRevisions | undefined> => {
                if (!appId || !environmentName) return undefined

                try {
                    const data = await fetchAllDeploymentRevisions(appId, environmentName)
                    return data
                } catch (error) {
                    console.error(
                        `Failed to fetch deployment history for ${environmentName}:`,
                        error,
                    )
                    return undefined
                }
            },
            enabled,
            staleTime: 2 * 60 * 1000, // 2 minutes
            gcTime: 5 * 60 * 1000, // 5 minutes
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: 1,
        }
    }),
)

/**
 * All deployment history atom (for all environments)
 */
export const environmentDeploymentHistoryAtom = atom<
    Record<string, DeploymentRevisions | undefined>
>((get) => {
    const environments = get(environmentsAtom)
    const history: Record<string, DeploymentRevisions | undefined> = {}

    environments.forEach((env) => {
        const historyQuery = environmentDeploymentHistoryQueryAtomFamily(env.name)
        const result = get(historyQuery)
        history[env.name] = (result as any)?.data
    })

    return history
})

/**
 * Recent deployment activity atom
 */
export const recentDeploymentActivityAtom = selectAtom(
    environmentDeploymentHistoryAtom,
    (
        history,
    ): {
        environmentName: string
        variantName: string | null
        revision: string | null
        deployedAt: string | null
        activity: "deployed" | "reverted" | "updated"
    }[] => {
        const activities: any[] = []

        Object.entries(history).forEach(([envName, deploymentHistory]) => {
            if (deploymentHistory?.revisions && deploymentHistory.revisions.length > 0) {
                // Get the most recent deployment
                const recent = deploymentHistory.revisions[0]
                activities.push({
                    environmentName: envName,
                    variantName: recent.variant_name || null,
                    revision: recent.revision || null,
                    deployedAt: recent.created_at || null,
                    activity: "deployed" as const,
                })
            }
        })

        // Sort by deployment time (most recent first)
        return activities
            .filter((a) => a.deployedAt)
            .sort((a, b) => new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime())
            .slice(0, 10) // Limit to 10 most recent
    },
    deepEqual,
)

// ============================================================================
// Cross-Environment Deployment Insights
// ============================================================================

/**
 * Variant deployment coverage atom
 * Shows which variants are deployed to which environments
 */
export const variantDeploymentCoverageAtom = selectAtom(
    environmentDeploymentStatusAtom,
    (statuses): Record<string, string[]> => {
        const coverage: Record<string, string[]> = {}

        statuses.forEach((status) => {
            if (status.deployedVariantName && status.isDeployed) {
                if (!coverage[status.deployedVariantName]) {
                    coverage[status.deployedVariantName] = []
                }
                coverage[status.deployedVariantName].push(status.environmentName)
            }
        })

        return coverage
    },
    deepEqual,
)

/**
 * Environment deployment readiness atom
 */
export const environmentDeploymentReadinessAtom = selectAtom(
    atom((get) => ({
        environments: get(environmentsAtom),
        deploymentStats: get(deploymentStatsAtom),
        loading: get(environmentsLoadingAtom),
    })),
    ({environments, deploymentStats, loading}) => ({
        totalEnvironments: environments.length,
        readyForDeployment: deploymentStats.emptyEnvironments,
        deploymentOpportunities: deploymentStats.emptyEnvironments > 0,
        hasEnvironments: environments.length > 0,
        loading,
        recommendations: {
            shouldCreateEnvironments: environments.length === 0,
            shouldDeployToEmpty: deploymentStats.emptyEnvironments > 0,
            shouldDiversifyDeployments:
                deploymentStats.uniqueVariantsDeployed < 2 && environments.length > 1,
        },
    }),
    deepEqual,
)
