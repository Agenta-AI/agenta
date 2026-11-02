import {
    buildAppDeploymentHistory,
    fetchEnvironmentRevisionsList,
} from "@agenta/entities/environment"
import {useQuery} from "@tanstack/react-query"

/**
 * The deployment history of one app in one environment, newest first. The key starts with
 * `["environments"]`, so a deploy or a revert (which invalidates that prefix) refreshes it.
 *
 * The request carries no app filter and no search: the server matches an app by id only, and a
 * search before the build would join deployments that were never next to each other. The helper
 * matches the app by id or slug and numbers the deployments, then `search` narrows the rows by
 * their note.
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
        queryKey: ["environments", "app-history", projectId, appId, environmentId],
        enabled: Boolean(projectId && appId && environmentId),
        queryFn: async () => {
            const response = await fetchEnvironmentRevisionsList({
                projectId,
                environmentId: environmentId ?? "",
            })
            return buildAppDeploymentHistory(response.environment_revisions, {
                id: appId,
                slug: appSlug,
            })
        },
        select: (rows) => {
            const term = search.trim().toLowerCase()
            return term ? rows.filter((row) => row.message?.toLowerCase().includes(term)) : rows
        },
    })
