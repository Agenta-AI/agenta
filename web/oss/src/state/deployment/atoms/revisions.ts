import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchAllDeploymentRevisions} from "@/oss/services/deploymentVersioning/api"
import {DeploymentRevisions} from "@/oss/services/deploymentVersioning/types"

/**
 * Atom family for fetching deployment revisions (deployment history) by environment name.
 * This provides automatic caching, background refresh, and loading states.
 *
 * @param envName - The environment name to fetch deployment revisions for
 * @returns Atom with query for deployment revisions
 */
export const deploymentRevisionsQueryAtomFamily = atomFamily((envName: string) =>
    atomWithQuery<DeploymentRevisions | undefined>((get) => {
        // Get appId from URL or context - we'll need to pass this as a parameter
        // For now, we'll create a parameterized version
        return {
            queryKey: ["deploymentRevisions", envName],
            queryFn: async (): Promise<DeploymentRevisions | undefined> => {
                // This will need appId - we'll create a parameterized version below
                throw new Error("Use deploymentRevisionsWithAppIdQueryAtomFamily instead")
            },
            enabled: false, // Disabled until we have appId
            staleTime: 1000 * 60 * 5, // 5 minutes
            refetchInterval: 1000 * 60 * 10, // 10 minutes
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
        }
    }),
)

/**
 * Atom family for fetching deployment revisions with both appId and environment name.
 * This is the main atom to use for deployment revisions.
 *
 * @param params - Object with appId and envName
 * @returns Atom with query for deployment revisions
 */
export const deploymentRevisionsWithAppIdQueryAtomFamily = atomFamily(
    ({appId, envName}: {appId: string; envName: string}) =>
        atomWithQuery<DeploymentRevisions | undefined>((get) => ({
            queryKey: ["deploymentRevisions", appId, envName],
            queryFn: async (): Promise<DeploymentRevisions | undefined> => {
                if (!appId || !envName) {
                    return undefined
                }

                try {
                    const data = await fetchAllDeploymentRevisions(appId, envName)
                    return data
                } catch (error) {
                    console.error(`Error fetching deployment revisions for ${envName}:`, error)
                    return undefined
                }
            },
            enabled: !!appId && !!envName,
            staleTime: 1000 * 60 * 5, // 5 minutes
            refetchInterval: 1000 * 60 * 10, // 10 minutes
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
        })),
    // Custom equality function for the parameter object
    (a, b) => a.appId === b.appId && a.envName === b.envName,
)

/**
 * Atom family for fetching deployment revisions for all environments of an app.
 * This creates a map of environment names to their deployment revisions.
 *
 * @param appId - The application ID
 * @returns Atom with query for all deployment revisions by environment
 */
export const allDeploymentRevisionsQueryAtomFamily = atomFamily((appId: string) =>
    atomWithQuery<Record<string, DeploymentRevisions | undefined>>((get) => ({
        queryKey: ["allDeploymentRevisions", appId],
        queryFn: async (): Promise<Record<string, DeploymentRevisions | undefined>> => {
            // This would need to fetch environments first, then fetch revisions for each
            // For now, we'll return an empty object and let individual environment atoms handle it
            return {}
        },
        enabled: !!appId,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchInterval: 1000 * 60 * 10, // 10 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
    })),
)
