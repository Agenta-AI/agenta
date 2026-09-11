import {
    ensureAgentFlags,
    queryWorkflows,
    selectAgentWorkflows,
    type Workflow,
} from "@agenta/entities/workflow"
import {useQuery} from "@tanstack/react-query"

/**
 * Archived agents — a SECOND query, deliberately, and only when the reader asks for them.
 *
 * The roster's own list (`agentWorkflowsListQueryStateAtom`) cannot serve this: it is built on
 * the shared apps query, which omits `include_archived` because the nav rail reads "absent from
 * that list" as "archived" (#6457). Flipping the flag there would break the rail, so the archived
 * set is fetched on its own and merged by the screen.
 *
 * Agent identity is revision-derived — an archived artifact carries no `is_agent` of its own —
 * so the artifacts are checked against the project's shared classification map. That map already
 * covers archived workflows and is fetched once per project, so this is one round trip for the
 * artifacts and, usually, a cache hit for the flags. `enabled` is still a prop: nothing here runs
 * until the Archived facet leaves its default.
 */
/** Stable, so a screen memoising on `agents` does not recompute on every render while disabled. */
const NONE: Workflow[] = []

export const useArchivedAgents = ({projectId, enabled}: {projectId: string; enabled: boolean}) => {
    const query = useQuery({
        // Under `agent-workflows` on purpose: `useAgentActions` invalidates that prefix after an
        // archive, so an agent this reader just archived leaves the live list and joins this one
        // in the same pass. A key of its own would have dropped it from both for a stale time.
        queryKey: ["agent-workflows", "archived", projectId],
        queryFn: async (): Promise<Workflow[]> => {
            const response = await queryWorkflows({
                projectId,
                flags: {is_evaluator: false},
                includeArchived: true,
            })
            const archived = (response.workflows ?? []).filter((workflow) => workflow.deleted_at)
            if (archived.length === 0) return []
            const agentFlags = await ensureAgentFlags(projectId)
            return selectAgentWorkflows(archived, agentFlags)
        },
        enabled: enabled && Boolean(projectId),
        staleTime: 30_000,
    })

    return {
        agents: query.data ?? NONE,
        // Pending only counts while the query is actually running: a disabled query is pending
        // forever in TanStack, and a list that never stops loading is worse than one without
        // archived rows.
        isPending: enabled && query.isPending,
        isError: query.isError,
        refetch: query.refetch,
    }
}
