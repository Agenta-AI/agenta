import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {EvaluationStatus} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"
import {getPreviewRunBatcher} from "../usePreviewEvaluations/assets/previewRunBatcher"

const REFETCH_INTERVAL = 10000

interface ResourceStatusResponse {
    count: number
    run: any
}

export const resourceStatusQueryFamily = atomFamily((id) =>
    atomWithQuery<ResourceStatusResponse>((get) => {
        const projectId = getProjectValues().projectId

        return {
            queryKey: ["resourceStatus", id, projectId],
            queryFn: async () => {
                if (!projectId) {
                    throw new Error("resourceStatusQueryFamily requires projectId")
                }

                const batcher = getPreviewRunBatcher()
                const run = await batcher({projectId, runId: id})

                return {
                    count: run ? 1 : 0,
                    run,
                }
            },

            // Poll every 5s until success; then stop polling.
            refetchInterval: (query) => {
                const data = query.state.data as ResourceStatusResponse | undefined

                if (
                    ![
                        EvaluationStatus.PENDING,
                        EvaluationStatus.RUNNING,
                        EvaluationStatus.CANCELLED,
                        EvaluationStatus.INITIALIZED,
                    ].includes(data?.run?.status)
                )
                    return false // stop polling
                return REFETCH_INTERVAL // keep polling
            },

            enabled: Boolean(id) && Boolean(projectId),

            // Avoid accidental refetches after success
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,

            // Reasonable cache/stale settings
            staleTime: 10_000,
            gcTime: 5 * 60 * 1000,
        }
    }),
)

// export const allResourceStatusesAtom = atom((get) => {
//    const ids = get(runningEvaluationIdsAtom)
//    const uniqueIds = Array.from(new Set(ids))
//     return uniqueIds.map((id) => get(resourceStatusQueryFamily(id)))
// })
