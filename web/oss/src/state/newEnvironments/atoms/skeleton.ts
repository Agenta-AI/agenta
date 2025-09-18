/**
 * Environment Skeleton Atoms
 *
 * Skeleton loading states for progressive UI rendering:
 * - Environment list skeletons
 * - Table skeleton states
 * - Deployment status skeletons
 * - Selector skeleton states
 */

import deepEqual from "fast-deep-equal"
// import {atom} from "jotai" // Will be used in future iterations
import {selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {Environment} from "@/oss/lib/Types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {projectIdAtom} from "@/oss/state/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"

import {EnvironmentDeploymentStatus} from "./deployments"
import {EnvironmentSelectorOption} from "./selectors"
import {EnvironmentTableRow} from "./table"

// ============================================================================
// Skeleton Data Generation
// ============================================================================

/**
 * Generate skeleton environment data
 */
const generateSkeletonEnvironmentData = (count = 3): Environment[] => {
    const skeletons: Environment[] = []

    for (let i = 0; i < count; i++) {
        skeletons.push({
            name: `Loading Environment ${i + 1}...`,
            app_id: "████████-████-████-████-████████████",
            deployed_app_variant_id:
                Math.random() > 0.5 ? "████████-████-████-████-████████████" : null,
            deployed_variant_name: Math.random() > 0.5 ? "Loading Variant..." : null,
            deployed_app_variant_revision_id:
                Math.random() > 0.5 ? "████████-████-████-████-████████████" : null,
            revision: Math.random() > 0.5 ? "Loading..." : null,
        })
    }

    return skeletons
}

/**
 * Generate skeleton table rows
 */
const generateSkeletonTableRows = (count = 3): EnvironmentTableRow[] => {
    const skeletons: EnvironmentTableRow[] = []

    for (let i = 0; i < count; i++) {
        const isDeployed = Math.random() > 0.5
        skeletons.push({
            id: `skeleton-env-${i}`,
            name: `Loading Environment ${i + 1}...`,
            appId: "████████-████-████-████-████████████",
            deployedVariantId: isDeployed ? "████████-████-████-████-████████████" : null,
            deployedVariantName: isDeployed ? "Loading Variant..." : null,
            deployedRevisionId: isDeployed ? "████████-████-████-████-████████████" : null,
            revision: isDeployed ? "Loading..." : null,
            isDeployed,
            deploymentStatus: isDeployed ? "deployed" : "empty",
            lastDeployment: isDeployed ? "Loading..." : null,
        })
    }

    return skeletons
}

/**
 * Generate skeleton selector options
 */
const generateSkeletonSelectorOptions = (count = 3): EnvironmentSelectorOption[] => {
    const skeletons: EnvironmentSelectorOption[] = []

    for (let i = 0; i < count; i++) {
        const isDeployed = Math.random() > 0.5
        skeletons.push({
            value: `skeleton-env-${i}`,
            label: `Loading Environment ${i + 1}...`,
            isDeployed,
            deployedVariant: isDeployed ? "Loading Variant..." : null,
            disabled: true,
        })
    }

    return skeletons
}

/**
 * Generate skeleton deployment status
 */
const generateSkeletonDeploymentStatus = (count = 3): EnvironmentDeploymentStatus[] => {
    const skeletons: EnvironmentDeploymentStatus[] = []

    for (let i = 0; i < count; i++) {
        const isDeployed = Math.random() > 0.5
        skeletons.push({
            environmentName: `Loading Environment ${i + 1}...`,
            isDeployed,
            deployedVariantId: isDeployed ? "████████-████-████-████-████████████" : null,
            deployedVariantName: isDeployed ? "Loading Variant..." : null,
            deployedRevisionId: isDeployed ? "████████-████-████-████-████████████" : null,
            revision: isDeployed ? "Loading..." : null,
            lastDeploymentTime: isDeployed ? "Loading..." : null,
            deploymentHealth: "unknown",
        })
    }

    return skeletons
}

// ============================================================================
// Skeleton Query Atoms
// ============================================================================

/**
 * Skeleton environments query atom
 * Provides skeleton data while real data loads
 */
export const environmentsSkeletonQueryAtom = atomWithQuery<Environment[]>((get) => {
    const appId = get(selectedAppIdAtom)
    const projectId = get(projectIdAtom)
    const jwtReady = get(jwtReadyAtom).data ?? false

    const enabled = !!appId && !!projectId && jwtReady

    return {
        queryKey: ["environmentsSkeleton", appId, projectId],
        queryFn: async (): Promise<Environment[]> => {
            // Simulate loading delay
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return generateSkeletonEnvironmentData()
        },
        enabled,
        staleTime: 0, // Always stale to show skeleton
        gcTime: 1000, // Short cache time
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
    }
})

// ============================================================================
// Main Skeleton Atoms
// ============================================================================

/**
 * Main environments skeleton atom
 */
export const environmentsSkeletonAtom = selectAtom(
    environmentsSkeletonQueryAtom,
    (result) => {
        if (!result) return generateSkeletonEnvironmentData()
        return (result as any)?.data ?? generateSkeletonEnvironmentData()
    },
    deepEqual,
)

/**
 * Environment table skeleton atom
 */
export const environmentTableSkeletonAtom = selectAtom(
    environmentsSkeletonAtom,
    (skeletonEnvironments) => ({
        rows: generateSkeletonTableRows(skeletonEnvironments.length),
        totalCount: skeletonEnvironments.length,
        deployedCount: Math.floor(skeletonEnvironments.length * 0.6),
        emptyCount: Math.ceil(skeletonEnvironments.length * 0.4),
        loading: true,
        error: null,
    }),
    deepEqual,
)

/**
 * Environment deployment skeleton atom
 */
export const environmentDeploymentSkeletonAtom = selectAtom(
    environmentsSkeletonAtom,
    (skeletonEnvironments) => generateSkeletonDeploymentStatus(skeletonEnvironments.length),
    deepEqual,
)

/**
 * Environment selector skeleton atom
 */
export const environmentSelectorSkeletonAtom = selectAtom(
    environmentsSkeletonAtom,
    (skeletonEnvironments) => ({
        options: generateSkeletonSelectorOptions(skeletonEnvironments.length),
        selectedValue: null,
        hasSelection: false,
        loading: true,
        isEmpty: false,
        deployedOptions: [],
        emptyOptions: [],
    }),
    deepEqual,
)

// ============================================================================
// Skeleton Detection Utilities
// ============================================================================

/**
 * Check if environment data contains skeleton items
 */
export const isSkeletonEnvironmentData = (environments: Environment[]): boolean => {
    return environments.some(
        (env) =>
            env.name.includes("Loading") || env.name.includes("...") || env.app_id.includes("████"),
    )
}

/**
 * Check if table data contains skeleton items
 */
export const isSkeletonTableData = (rows: EnvironmentTableRow[]): boolean => {
    return rows.some(
        (row) =>
            row.name.includes("Loading") || row.name.includes("...") || row.appId.includes("████"),
    )
}

/**
 * Environment skeleton detection atom
 */
export const environmentSkeletonDetectionAtom = selectAtom(
    environmentsSkeletonAtom,
    (skeletonData) => ({
        hasSkeletonData: isSkeletonEnvironmentData(skeletonData),
        skeletonCount: skeletonData.length,
        skeletonTypes: ["environments", "table", "selector", "deployment"],
        isLoading: true,
    }),
    deepEqual,
)
