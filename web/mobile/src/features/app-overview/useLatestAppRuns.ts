import {
    evaluationRunsListQueryKey,
    isRunInProgress,
    queryEvaluationRunsPage,
    seedEvaluationRunCache,
} from "@agenta/entities/evaluationRun"
import {useQuery, useQueryClient} from "@tanstack/react-query"

import {EVALUATION_RUNS_POLL_MS} from "../evaluations/list/useEvaluationRunsList"

export const LATEST_RUNS_COUNT = 5

export type AppRunKind = "auto" | "human"

/**
 * The newest runs of one kind for one app. The key extends the runs list key, so a list refresh
 * reaches it, and it ends in its own marker, so the 30-row infinite list never shares an entry
 * with this 5-row query. It refreshes every five seconds while a run is in progress.
 */
export const useLatestAppRuns = ({
    projectId,
    appId,
    kind,
}: {
    projectId: string
    appId: string
    kind: AppRunKind
}) => {
    const queryClient = useQueryClient()
    return useQuery({
        queryKey: [
            ...evaluationRunsListQueryKey(projectId, {appId, kinds: [kind]}),
            "latest",
            LATEST_RUNS_COUNT,
        ],
        queryFn: async () => {
            const page = await queryEvaluationRunsPage({
                projectId,
                limit: LATEST_RUNS_COUNT,
                appId,
                kinds: [kind],
            })
            seedEvaluationRunCache(queryClient, page.runs)
            return page.runs
        },
        enabled: Boolean(projectId && appId),
        refetchInterval: (current) =>
            current.state.data?.some(isRunInProgress) ? EVALUATION_RUNS_POLL_MS : false,
    })
}
