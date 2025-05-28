import type {SWRConfiguration} from "swr"
import useSWR from "swr"

import {getCurrentProject} from "@/oss/contexts/project.context"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"

interface UseEvaluationResultsOptions extends SWRConfiguration {
    evaluationId?: string
}

export const useEvaluationResults = ({evaluationId, ...rest}: UseEvaluationResultsOptions = {}) => {
    const {projectId} = getCurrentProject()

    const swr = useSWR(
        evaluationId && projectId
            ? `${getAgentaApiUrl()}/human-evaluations/${evaluationId}/results?project_id=${projectId}`
            : null,
        {
            ...rest,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    return swr
}
