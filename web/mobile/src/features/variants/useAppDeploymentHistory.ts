import {
    buildAppDeploymentHistory,
    fetchEnvironmentRevisionsList,
    type EnvironmentRevision,
} from "@agenta/entities/environment"
import {useQuery} from "@tanstack/react-query"

/** The server returns at most this many revisions per call; a full page means more may follow. */
const PAGE_SIZE = 100
const MAX_PAGES = 50

interface AppHistoryTarget {
    projectId: string
    appId: string
    appSlug: string | null
    environmentId: string | null
}

/** One app's deployment history in one environment, newest first; paged in full so apps never mix. */
export const appDeploymentHistoryQuery = ({
    projectId,
    appId,
    appSlug,
    environmentId,
}: AppHistoryTarget) => ({
    queryKey: ["environments", "app-history", projectId, appId, environmentId] as const,
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
        return buildAppDeploymentHistory(revisions, {id: appId, slug: appSlug})
    },
})

/** The deployment history of one app in one environment; `search` narrows rows by their note. */
export const useAppDeploymentHistory = ({search, ...target}: AppHistoryTarget & {search: string}) =>
    useQuery({
        ...appDeploymentHistoryQuery(target),
        select: (rows) => {
            const term = search.trim().toLowerCase()
            return term ? rows.filter((row) => row.message?.toLowerCase().includes(term)) : rows
        },
    })
