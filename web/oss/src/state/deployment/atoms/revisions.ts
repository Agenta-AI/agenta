import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchAllDeploymentRevisions} from "@/oss/services/deploymentVersioning/api"
import {DeploymentRevisions} from "@/oss/services/deploymentVersioning/types"

import {userAtom} from "../../profile"
import {projectIdAtom} from "../../project"
import {sessionExistsAtom} from "../../session"

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
            const sessionExists = get(sessionExistsAtom)
            const user = get(userAtom)
            const userId = user?.id
            console.log("user", {user, sessionExists, userId, projectId, appId, envName})
            return {
                queryKey: ["deploymentRevisions", appId, envName],
                queryFn: async (): Promise<DeploymentRevisions | undefined> => {
                    console.log("deploymentRevisionsWithAppIdQueryAtomFamily 1")
                    if (!appId || !envName) {
                        return {}
                    }

                    console.log("deploymentRevisionsWithAppIdQueryAtomFamily 2")
                    try {
                        const data = await fetchAllDeploymentRevisions(appId, envName)
                        console.log("deploymentRevisionsWithAppIdQueryAtomFamily 3", data)
                        return data
                    } catch (error) {
                        console.warn(`Error fetching deployment revisions for ${envName}:`, {
                            error,
                            projectId,
                            sessionExists,
                            userId,
                        })
                        return {}
                    }
                },
                enabled: !!userId && sessionExists && !!projectId && !!appId && !!envName,
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
