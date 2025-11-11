import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {Evaluator, EvaluatorConfig} from "@/oss/lib/Types"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import {
    EvaluatorDto,
    EvaluatorPreviewDto,
    EvaluatorsResponseDto,
} from "@/oss/lib/hooks/useEvaluators/types"
import {fetchAllEvaluators, fetchAllEvaluatorConfigs} from "@/oss/services/evaluators"
import {selectedAppIdAtom} from "@/oss/state/app"
import {selectedOrgAtom} from "@/oss/state/org"
import {projectIdAtom} from "@/oss/state/project"
import {userAtom} from "@/oss/state/profile"
import {EvaluatorConfigsParams, EvaluatorsParams} from "./types"
import {NO_APP_KEY, NO_PROJECT_KEY} from "./constant"
import {parseQueries} from "./parse"

export const evaluatorConfigsQueryAtomFamily = atomFamily(
    ({projectId: overrideProjectId, appId: overrideAppId, preview}: EvaluatorConfigsParams = {}) =>
        atomWithQuery<EvaluatorConfig[]>((get) => {
            const projectId = overrideProjectId ?? get(projectIdAtom)
            const appId = overrideAppId ?? get(selectedAppIdAtom)
            const user = get(userAtom) as {id?: string} | null

            const enabled = !preview && Boolean(projectId && user?.id)
            const projectKey = projectId ?? NO_PROJECT_KEY
            const appKey = appId ?? NO_APP_KEY

            return {
                queryKey: [
                    "evaluator-configs",
                    preview ? "preview" : "regular",
                    projectKey,
                    appKey,
                ] as const,
                queryFn: async () => fetchAllEvaluatorConfigs(appId, projectId),
                staleTime: 60_000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: false,
                retry: false,
                enabled,
            }
        }),
)

export const evaluatorsQueryAtomFamily = atomFamily(
    ({projectId: overrideProjectId, preview, queriesKey}: EvaluatorsParams) =>
        atomWithQuery<Evaluator[] | EvaluatorPreviewDto[]>((get) => {
            const projectId = overrideProjectId ?? get(projectIdAtom)
            const user = get(userAtom) as {id?: string} | null
            const selectedOrg = get(selectedOrgAtom)
            const members = selectedOrg?.default_workspace?.members ?? []
            const projectKey = projectId ?? NO_PROJECT_KEY

            const enabled = Boolean(projectId && user?.id)
            const queryKey = preview
                ? (["evaluators", "preview", projectKey, queriesKey] as const)
                : (["evaluators", projectKey] as const)

            return {
                queryKey,
                queryFn: async () => {
                    if (preview) {
                        if (!projectId) return []
                        const flags = parseQueries(queriesKey)
                        const response = await axios.post<EvaluatorsResponseDto>(
                            `/preview/simple/evaluators/query?project_id=${projectId}`,
                            flags
                                ? {
                                      evaluator: {flags},
                                  }
                                : {},
                        )
                        const evaluators =
                            response?.data?.evaluators?.map((item) =>
                                transformApiData<EvaluatorDto>({
                                    data: item,
                                    members,
                                }),
                            ) ?? []
                        return evaluators.map((evaluator) => ({
                            ...evaluator,
                            metrics: getMetricsFromEvaluator(evaluator as EvaluatorDto),
                        })) as EvaluatorPreviewDto[]
                    }

                    const data = await fetchAllEvaluators()
                    return data
                },
                staleTime: 60_000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: false,
                retry: false,
                enabled,
            }
        }),
)
