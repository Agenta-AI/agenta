import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchAllDeploymentRevisions} from "@/oss/services/deploymentVersioning/api"
import {DeploymentRevisions} from "@/oss/services/deploymentVersioning/types"

import {projectIdAtom} from "../../project"

/**
 * Atom family for fetching deployment revisions with both appId and environment name.
 * This is the main atom to use for deployment revisions.
 *
 * @param params - Object with appId and envName
 * @returns Atom with query for deployment revisions
 */
export const deploymentRevisionsWithAppIdQueryAtomFamily = atomFamily(
    ({appId, envName}: {appId: string; envName: string}) => {
        return atomWithQuery<DeploymentRevisions | undefined>((get) => {
            const projectId = get(projectIdAtom)
            return {
                queryKey: ["deploymentRevisions", appId, envName],
                queryFn: async (): Promise<DeploymentRevisions | undefined> => {
                    if (!appId || !envName) {
                        return {}
                    }

                    try {
                        const data = await fetchAllDeploymentRevisions(appId, envName)
                        return data
                    } catch (error) {
                        console.error(`Error fetching deployment revisions for ${envName}:`, error)
                        return {}
                    }
                },
                enabled: !!projectId && !!appId && !!envName,
                staleTime: 1000 * 60 * 5, // 5 minutes
                refetchInterval: 1000 * 60 * 10, // 10 minutes
                refetchOnWindowFocus: false,
                refetchOnReconnect: true,
            }
        })
    },
    // Custom equality function for the parameter object
    (a, b) => a.appId === b.appId && a.envName === b.envName,
)
