import useSWR from "swr"

import {useOrgData} from "@/oss/contexts/org.context"
import {getCurrentProject} from "@/oss/contexts/project.context"

import {transformApiData} from "../useAnnotations/assets/transformer"

import {EvaluatorDto, EvaluatorResponseDto} from "./types"

const useEvaluators = () => {
    const {selectedOrg} = useOrgData()
    const {projectId} = getCurrentProject()
    const workspace = selectedOrg?.default_workspace
    const members = workspace?.members || []

    const {data, ...rest} = useSWR<EvaluatorResponseDto>(
        `/api/preview/evaluators/?project_id=${projectId}`,
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    return {
        data:
            data?.evaluator.map((evaluator) =>
                transformApiData<EvaluatorDto>({data: evaluator, members}),
            ) || [],
        ...rest,
    }
}

export default useEvaluators
