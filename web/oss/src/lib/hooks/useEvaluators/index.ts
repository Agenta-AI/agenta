import useSWR from "swr"

import {useOrgData} from "@/oss/contexts/org.context"
import {getCurrentProject} from "@/oss/contexts/project.context"

import {transformApiData} from "../useAnnotations/assets/transformer"

import {EvaluatorDto, EvaluatorsResponseDto} from "./types"

const useEvaluators = () => {
    const {selectedOrg} = useOrgData()
    const {projectId} = getCurrentProject()
    const workspace = selectedOrg?.default_workspace
    const members = workspace?.members || []

    const {data, ...rest} = useSWR<EvaluatorsResponseDto>(
        `/preview/simple/evaluators/?project_id=${projectId}`,
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
        },
    )

    return {
        data:
            data?.evaluators?.map((evaluator) =>
                transformApiData<EvaluatorDto>({data: evaluator, members}),
            ) || [],
        ...rest,
    }
}

export default useEvaluators
