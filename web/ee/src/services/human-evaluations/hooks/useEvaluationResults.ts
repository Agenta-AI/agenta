import type {SWRConfiguration} from "swr"
import useSWR from "swr"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {getProjectValues} from "@/oss/state/project"

interface UseEvaluationResultsOptions extends SWRConfiguration {
    evaluationId?: string
}

export const useEvaluationResults = ({evaluationId, ...rest}: UseEvaluationResultsOptions = {}) => {
    const {projectId} = getProjectValues()

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
