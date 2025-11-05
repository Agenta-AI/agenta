import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import {
    EvaluatorDto,
    EvaluatorPreviewDto,
    EvaluatorsResponseDto,
} from "@/oss/lib/hooks/useEvaluators/types"
import {Evaluator, EvaluatorConfig} from "@/oss/lib/Types"
import {fetchAllEvaluators, fetchAllEvaluatorConfigs} from "@/oss/services/evaluators"
import {selectedAppIdAtom} from "@/oss/state/app"
import {selectedOrgAtom} from "@/oss/state/org"
import {userAtom} from "@/oss/state/profile"
import {projectIdAtom} from "@/oss/state/project"

import {NO_APP_KEY, NO_PROJECT_KEY} from "./constant"
import {parseQueries} from "./parse"
import {EvaluatorConfigsParams, EvaluatorsParams} from "./types"

const extractKeyFromUri = (uri: unknown): string | undefined => {
    if (typeof uri !== "string") return undefined
    const match = uri.match(/[:/](auto_[a-z0-9_]+)/i)
    if (match?.[1]) return match[1]
    const parts = uri.split(":").filter(Boolean)
    if (parts.length) {
        const candidate = parts[parts.length - 1]
        if (candidate) {
            return candidate.replace(/-v\d+$/i, "")
        }
    }
    return undefined
}

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
                        const requestBody = flags
                            ? {
                                  evaluator: {flags},
                              }
                            : {}

                        const response = await axios.post<EvaluatorsResponseDto>(
                            `/preview/simple/evaluators/query?project_id=${projectId}`,
                            requestBody,
                        )
                        const evaluators = (response?.data?.evaluators ?? []).map((item) => {
                            const transformed = transformApiData<EvaluatorDto>({
                                data: item,
                                members,
                            })

                            const rawTags = item?.tags ?? transformed?.tags
                            const tags = Array.isArray(rawTags)
                                ? rawTags
                                : rawTags && typeof rawTags === "object"
                                  ? Object.values(rawTags as Record<string, unknown>)
                                        .map((value) => String(value))
                                        .filter(Boolean)
                                  : typeof rawTags === "string"
                                    ? [rawTags]
                                    : []

                            const rawKey =
                                item?.flags?.evaluator_key ??
                                item?.meta?.evaluator_key ??
                                item?.key ??
                                transformed?.key ??
                                undefined
                            const derivedKey =
                                typeof rawKey === "string" && rawKey.trim()
                                    ? rawKey.trim()
                                    : extractKeyFromUri(
                                          (item as any)?.data?.uri ||
                                              (item as any)?.data?.service?.uri,
                                      )
                            const requiresLlmApiKeys =
                                item?.requires_llm_api_keys ??
                                item?.flags?.requires_llm_api_keys ??
                                item?.meta?.requires_llm_api_keys ??
                                transformed?.requires_llm_api_keys ??
                                false

                            return {
                                ...transformed,
                                tags,
                                key: derivedKey,
                                requires_llm_api_keys: Boolean(requiresLlmApiKeys),
                                metrics: getMetricsFromEvaluator(transformed as EvaluatorDto),
                            }
                        }) as EvaluatorPreviewDto[]

                        return evaluators
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
