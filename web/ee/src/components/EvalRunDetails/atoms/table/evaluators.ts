import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {projectIdAtom} from "@/oss/state/project"

import {evaluationRunQueryAtomFamily} from "./run"
import type {EvaluatorDefinition, MetricColumnDefinition} from "./types"

export interface EvaluatorQueryArgs {
    ids?: string[]
    flags?: Record<string, boolean>
}

const METRIC_TYPE_FALLBACK = "string"

const titleize = (value: string) =>
    value
        .replace(/[_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())

const buildEvaluatorQueryKey = (
    projectId: string | null,
    ids: string[],
    flags?: Record<string, boolean>,
) => ["preview", "evaluators", projectId, ids.join("|"), flags || null]

const extractMetrics = (evaluator: any): MetricColumnDefinition[] => {
    const properties = evaluator?.data?.schemas?.outputs?.properties || {}
    return Object.entries(properties).map(([key, schema]: [string, any]) => ({
        name: key,
        kind: "metric",
        path: key,
        stepKey: evaluator.slug || evaluator.id || "metric",
        metricType: typeof schema?.type === "string" ? schema.type : METRIC_TYPE_FALLBACK,
        displayLabel: typeof schema?.title === "string" ? schema.title : titleize(key),
        description: typeof schema?.description === "string" ? schema.description : undefined,
    }))
}

const fetchEvaluators = async ({
    projectId,
    ids,
    flags,
}: {
    projectId: string
    ids: string[]
    flags?: Record<string, boolean>
}): Promise<EvaluatorDefinition[]> => {
    console.debug("[EvaluationRunsTablePOC] fetchEvaluators")
    if (!ids.length && !flags) {
        return []
    }

    const payload: Record<string, any> = {}
    if (ids.length) {
        payload.evaluator_refs = ids.map((id) => ({id}))
    }
    if (flags) {
        payload.evaluator = {flags}
    }

    const response = await axios.post(`/preview/simple/evaluators/query`, payload, {
        params: {project_id: projectId},
    })
    const rawEvaluators = Array.isArray(response?.data?.evaluators) ? response.data.evaluators : []

    const processedEvaluators = rawEvaluators.map((raw) => {
        const evaluator = snakeToCamelCaseKeys(raw)
        return {
            id: evaluator.id,
            name: evaluator.name || evaluator.slug || evaluator.id,
            slug: evaluator.slug,
            description: evaluator.description,
            version:
                evaluator.version ?? evaluator.data?.version ?? evaluator.meta?.version ?? null,
            metrics: extractMetrics(evaluator),
            raw: evaluator,
        }
    })

    console.debug("[EvaluationRunsTablePOC] Evaluators", {processedEvaluators})

    return processedEvaluators
}

export const previewEvaluatorsQueryAtomFamily = atomFamily(
    ({ids = [], flags}: EvaluatorQueryArgs) =>
        atomWithQuery<EvaluatorDefinition[]>((get) => {
            const projectId = get(projectIdAtom)
            const uniqueIds = Array.from(new Set(ids))
                .map((id) => id)
                .sort()

            return {
                queryKey: buildEvaluatorQueryKey(projectId ?? null, uniqueIds, flags),
                enabled:
                    Boolean(projectId) &&
                    (uniqueIds.length > 0 || (flags && Object.keys(flags).length > 0)),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId) return []
                    return fetchEvaluators({projectId, ids: uniqueIds, flags})
                },
            }
        }),
)

export const buildEvaluatorQueryKeyForIds = (projectId: string, ids: string[]) =>
    buildEvaluatorQueryKey(projectId, Array.from(new Set(ids)).sort())

export const evaluationEvaluatorsByRunQueryAtomFamily = atomFamily((runId: string | null) =>
    atomWithQuery<EvaluatorDefinition[]>((get) => {
        const projectId = get(projectIdAtom)
        const runQuery = runId ? get(evaluationRunQueryAtomFamily(runId)) : undefined
        const evaluatorIds = runQuery?.data
            ? Array.from(
                  new Set(
                      Object.values(runQuery.data.runIndex.steps)
                          .map((step: any) => step?.refs?.evaluator?.id)
                          .filter((id): id is string => Boolean(id)),
                  ),
              )
            : []

        return {
            queryKey: buildEvaluatorQueryKey(projectId ?? null, evaluatorIds),
            enabled:
                Boolean(projectId && runId && evaluatorIds.length > 0) && Boolean(runQuery?.data),
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId || !runId || evaluatorIds.length === 0) return []
                return fetchEvaluators({projectId, ids: evaluatorIds})
            },
        }
    }),
)
