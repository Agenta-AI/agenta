import {getCurrentProject} from "@/contexts/project.context"
import type {SWRConfiguration} from "swr"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import useSWR from "swr"

interface UseEvaluationResultsOptions extends SWRConfiguration {
    evaluationId?: string
}

export const useEvaluationResults = ({evaluationId, ...rest}: UseEvaluationResultsOptions = {}) => {
    const {projectId} = getCurrentProject()

    const swr = useSWR(
        evaluationId && projectId
            ? `${getAgentaApiUrl()}/api/human-evaluations/${evaluationId}/results?project_id=${projectId}`
            : null,
        {
            ...rest,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    return swr
}
