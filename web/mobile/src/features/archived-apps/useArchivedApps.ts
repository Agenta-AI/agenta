import {
    ensureAgentFlags,
    queryWorkflows,
    selectNonAgentWorkflows,
    type Workflow,
} from "@agenta/entities/workflow"
import {keepPreviousData, useQuery} from "@tanstack/react-query"

/** Query key for the archived apps list. Under `workflows` so a restore refreshes it. */
export const ARCHIVED_APPS_QUERY_KEY = (projectId: string, search: string) =>
    ["workflows", "archived-apps", projectId, search] as const

/** Stable, so a screen memoising on `apps` does not recompute on every render without data. */
const NONE: Workflow[] = []

export const useArchivedApps = ({projectId, search}: {projectId: string; search: string}) => {
    const query = useQuery({
        queryKey: ARCHIVED_APPS_QUERY_KEY(projectId, search),
        queryFn: async (): Promise<Workflow[]> => {
            const response = await queryWorkflows({
                projectId,
                name: search.trim() || undefined,
                flags: {is_evaluator: false},
                includeArchived: true,
            })
            // Sort a copy. The response array is not ours to reorder.
            const archived = (response.workflows ?? [])
                .filter((workflow) => workflow.deleted_at)
                .sort((a, b) => (b.deleted_at ?? "").localeCompare(a.deleted_at ?? ""))
            if (archived.length === 0) return []
            const agentFlags = await ensureAgentFlags(projectId)
            return selectNonAgentWorkflows(archived, agentFlags)
        },
        enabled: Boolean(projectId),
        // Keep the last rows on screen while a new search loads, so typing does not blank the list.
        placeholderData: keepPreviousData,
        staleTime: 30_000,
    })

    return {
        apps: query.data ?? NONE,
        isPending: query.isPending,
        isError: query.isError,
        refetch: query.refetch,
    }
}
