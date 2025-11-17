import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import type {_Evaluation} from "@/oss/lib/Types"

import {fetchAllEvaluations} from "../../services/evaluations/api"

export interface LegacyEvaluationListParams {
    appIds: string[]
    enabled?: boolean
}

export interface LegacyAutoEvaluation {
    id: string
    appId: string
    user: {
        id: string
        username: string
    }
    testset: {
        id: string
        name: string
    }
    status: {
        type: string
        value: string
        error: unknown
    }
    variants: {variantId: string; variantName: string}[]
    aggregatedResults: Array<{
        evaluatorConfig: unknown
        result: unknown
    }>
    createdAt?: string
    updatedAt?: string
    duration?: number
    revisions: string[]
    averageLatency?: unknown
    averageCost?: unknown
    totalCost?: unknown
    variantRevisionIds: string[]
}

export const normalizeLegacyAutoEvaluation = (evaluation: _Evaluation): LegacyAutoEvaluation => {
    const camel = snakeToCamelCaseKeys(evaluation) as LegacyAutoEvaluation & {
        created_at?: string
        updated_at?: string
    }

    return {
        ...camel,
        aggregatedResults:
            (camel as any).aggregatedResults ??
            (camel as any).aggregated_results ??
            evaluation.aggregated_results,
        createdAt: camel.createdAt ?? (camel as any).created_at ?? undefined,
        updatedAt: camel.updatedAt ?? (camel as any).updated_at ?? undefined,
    }
}

const gatherAppIds = (appIds: string[] | undefined) =>
    Array.isArray(appIds)
        ? appIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : []

/**
 * Declarative atom for querying legacy (non-preview) auto evaluations.
 * Consumers can scope the query by application IDs and optionally disable it.
 */
export const legacyAutoEvaluationsQueryFamily = atomFamily((params: LegacyEvaluationListParams) =>
    atomWithQuery<LegacyAutoEvaluation[]>(() => {
        const appIds = gatherAppIds(params.appIds)
        const enabled = params.enabled ?? true

        return {
            queryKey: ["legacy-evaluations", "auto", appIds],
            enabled: enabled && appIds.length > 0,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!enabled || appIds.length === 0) {
                    return []
                }

                const responses = await Promise.all(
                    appIds.map(async (appId) => {
                        const evaluations = await fetchAllEvaluations(appId)
                        return evaluations.map((evaluation) =>
                            normalizeLegacyAutoEvaluation({...evaluation, appId}),
                        )
                    }),
                )

                const flattened = responses.flat()
                return flattened.sort((a, b) => {
                    const tsA = new Date((a as any)?.createdAt ?? 0).getTime()
                    const tsB = new Date((b as any)?.createdAt ?? 0).getTime()
                    return tsB - tsA
                })
            },
        }
    }),
)

export default legacyAutoEvaluationsQueryFamily
