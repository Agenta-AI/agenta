import {getCurrentProject} from "@/oss/contexts/project.context"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {EnrichedEvaluationRun} from "../usePreviewEvaluations/types"

import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"
import {EvaluationStatus} from "@/oss/lib/Types"

const REFETCH_INTERVAL = 10000

export const resourceStatusQueryFamily = atomFamily((id) =>
    atomWithQuery<EnrichedEvaluationRun>((get) => {
        const projectId = getCurrentProject().projectId

        return {
            queryKey: ["resourceStatus", id, projectId],
            queryFn: async () => {
                const res = await axios.get(
                    `/preview/evaluations/runs/${id}?project_id=${projectId}`,
                )
                return res.data
            },

            // Poll every 5s until success; then stop polling.
            refetchInterval: (query) => {
                const data = query.state.data as EnrichedEvaluationRun | undefined

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
