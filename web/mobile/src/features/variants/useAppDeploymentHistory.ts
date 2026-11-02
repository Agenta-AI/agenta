import {
    buildAppDeploymentHistory,
    fetchEnvironmentRevisionsList,
    type EnvironmentRevision,
} from "@agenta/entities/environment"
import {useQuery} from "@tanstack/react-query"

/** The server returns at most this many revisions per call; a full page means more may follow. */
const PAGE_SIZE = 100
const MAX_PAGES = 50

/**
 * The deployment history of one app in one environment, newest first. The key starts with
 * `["environments"]`, so a deploy or a revert (which invalidates that prefix) refreshes it.
 *
 * The hook pages through every revision of the environment (newest first, by cursor), so a
 * truncated list can never mix apps. The request carries no app filter and no search: the server matches an app by id only, and a
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
            const revisions: EnvironmentRevision[] = []
            let next: string | undefined
            for (let page = 0; page < MAX_PAGES; page++) {
                const response = await fetchEnvironmentRevisionsList({
                    projectId,
                    environmentId: environmentId ?? "",
                    next,
                })
                revisions.push(...response.environment_revisions)
                if (response.environment_revisions.length < PAGE_SIZE) break
                next = response.environment_revisions.at(-1)?.id
                if (!next) break
            }
            return buildAppDeploymentHistory(revisions, {
                id: appId,
                slug: appSlug,
            })
        },
        select: (rows) => {
            const term = search.trim().toLowerCase()
            return term ? rows.filter((row) => row.message?.toLowerCase().includes(term)) : rows
        },
    })
