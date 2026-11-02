import {
    buildAppDeploymentHistory,
    fetchEnvironmentRevisionsList,
} from "@agenta/entities/environment"
import {useQuery} from "@tanstack/react-query"

/**
 * The deployment history of one app in one environment, newest first. The key starts with
 * `["environments"]`, so a deploy or a revert (which invalidates that prefix) refreshes it.
 */
export const useAppDeploymentHistory = ({
    projectId,
    appId,
    appSlug,
    environmentId,
    search,
}: {
    projectId: string
    appId: string
    appSlug: string | null
    environmentId: string | null
    search: string
}) =>
    useQuery({
        queryKey: ["environments", "app-history", projectId, appId, environmentId, search],
        enabled: Boolean(projectId && appId && environmentId),
        queryFn: async () => {
            const response = await fetchEnvironmentRevisionsList({
                projectId,
                environmentId: environmentId ?? "",
                applicationId: appId,
                message: search || undefined,
            })
            return buildAppDeploymentHistory(response.environment_revisions, {
                id: appId,
                slug: appSlug,
            })
        },
    })
