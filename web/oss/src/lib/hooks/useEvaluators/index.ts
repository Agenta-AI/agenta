import {useCallback} from "react"

import useSWR, {SWRResponse} from "swr"

import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {fetchAllEvaluators} from "@/oss/services/evaluators"
import {useOrgData} from "@/oss/state/org"
import {DEFAULT_UUID, getProjectValues} from "@/oss/state/project"

import axios from "../../api/assets/axiosConfig"
import {Evaluator} from "../../Types"
import {transformApiData} from "../useAnnotations/assets/transformer"

import {
    EvaluatorDto,
    EvaluatorsResponseDto,
    EvaluatorPreviewDto,
    UseEvaluatorsOptions,
} from "./types"

type UseEvaluatorsReturn<Preview extends boolean> = SWRResponse<
    Preview extends true ? EvaluatorPreviewDto[] : Evaluator[],
    any
>

const useEvaluators = <Preview extends boolean = false>({
    preview,
    queries,
    ...options
}: UseEvaluatorsOptions & {
    preview?: Preview
    queries?: {is_human: boolean}
}): UseEvaluatorsReturn<Preview> => {
    const {selectedOrg} = useOrgData()
    const projectId = options?.projectId || getProjectValues()?.projectId || ""
    const workspace = selectedOrg?.default_workspace
    const members = workspace?.members || []

    type Data = Preview extends true ? EvaluatorPreviewDto[] : Evaluator[]

    const fetcher = useCallback(async (): Promise<Data> => {
        if (preview) {
            const response = await axios.post<EvaluatorsResponseDto>(
                `/preview/simple/evaluators/query?project_id=${projectId}`,
                queries
                    ? {
                          evaluator: {
                              flags: queries,
                          },
                      }
                    : {},
            )
            const data =
                (response?.data?.evaluators || []).map((evaluator) =>
                    transformApiData<EvaluatorDto>({data: evaluator, members}),
                ) || []
            const withMetrics = data.map((d) => ({
                ...d,
                metrics: getMetricsFromEvaluator(d as EvaluatorDto),
            }))
            return withMetrics as unknown as Data
        } else {
            // Non-preview mode returns full Evaluator objects
            const data = await fetchAllEvaluators()
            return data as Data
        }
    }, [projectId, preview, queries])

    return useSWR<Preview extends true ? EvaluatorPreviewDto[] : Evaluator[]>(
        projectId && projectId !== DEFAULT_UUID
            ? `/api${preview ? "/preview" : ""}/evaluators/?project_id=${projectId}&queries=${JSON.stringify(queries)}`
            : null,
        fetcher,
        {
            revalidateOnFocus: false,
            shouldRetryOnError: false,
            ...options,
        },
    )
}

export default useEvaluators
