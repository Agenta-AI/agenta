import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"

import createBatchFetcher from "@/oss/state/utils/createBatchFetcher"

import {effectiveProjectIdAtom} from "../run"

import {evaluationRunQueryAtomFamily} from "./run"
import type {EvaluatorDefinition, MetricColumnDefinition} from "./types"

interface EvaluatorReferenceInput {
    id?: string | null
    slug?: string | null
}

export interface EvaluatorQueryArgs {
    ids?: string[]
    refs?: EvaluatorReferenceInput[]
    flags?: Record<string, boolean>
}

const METRIC_TYPE_FALLBACK = "string"

const titleize = (value: string) =>
    value
        .replace(/[_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\w/g, (char) => char.toUpperCase())

const sanitizeReferenceValue = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined

const normalizeEvaluatorRefs = (refs: EvaluatorReferenceInput[]): EvaluatorReferenceInput[] => {
    const deduped = new Map<string, EvaluatorReferenceInput>()
    refs.forEach((ref) => {
        const id = sanitizeReferenceValue(ref?.id)
        const slug = sanitizeReferenceValue(ref?.slug)
        if (!id && !slug) return
        const key = `${id ?? ""}:${slug ?? ""}`
        if (!deduped.has(key)) {
            deduped.set(key, {id, slug})
        }
    })
    return Array.from(deduped.values()).sort((a, b) => {
        const aKey = a.id ?? a.slug ?? ""
        const bKey = b.id ?? b.slug ?? ""
        return aKey.localeCompare(bKey)
    })
}

const mergeEvaluatorRefs = (
    ids: string[] = [],
    refs: EvaluatorReferenceInput[] = [],
): EvaluatorReferenceInput[] => {
    const idRefs = ids
        .map((id) => sanitizeReferenceValue(id))
        .filter((value): value is string => Boolean(value))
        .map((id) => ({id}))
    return normalizeEvaluatorRefs([...(refs ?? []), ...idRefs])
}

const normalizeFlags = (flags?: Record<string, boolean> | null): Record<string, boolean> | null => {
    if (!flags) return null
    const entries = Object.entries(flags).filter(([, value]) => typeof value === "boolean")
    if (!entries.length) return null
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

const buildEvaluatorQueryKey = (
    projectId: string | null,
    refs: EvaluatorReferenceInput[],
    flags?: Record<string, boolean>,
) => {
    const normalizedRefs = normalizeEvaluatorRefs(refs)
    return [
        "preview",
        "evaluators",
        projectId,
        normalizedRefs.map((ref) => `${ref.id ?? ""}:${ref.slug ?? ""}`).join("|"),
        normalizeFlags(flags) ?? null,
    ]
}

const extractMetrics = (evaluator: any): MetricColumnDefinition[] => {
    const properties =
        evaluator?.data?.schemas?.outputs?.properties ||
        evaluator?.data?.service?.format?.properties?.outputs?.properties ||
        {}
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

const toEvaluatorDefinition = (raw: any): EvaluatorDefinition => {
    const evaluator = snakeToCamelCaseKeys(raw)
    return {
        id: evaluator.id,
        name: evaluator.name || evaluator.slug || evaluator.id,
        slug: evaluator.slug,
        description: evaluator.description,
        version: evaluator.version ?? evaluator.data?.version ?? evaluator.meta?.version ?? null,
        metrics: extractMetrics(evaluator),
        raw: evaluator,
    }
}

interface EvaluatorFetchRequest {
    projectId: string
    refs: EvaluatorReferenceInput[]
    flags?: Record<string, boolean> | null
}

const evaluatorFetchBatcher = createBatchFetcher<EvaluatorFetchRequest, EvaluatorDefinition[]>({
    serializeKey: (request) =>
        JSON.stringify({
            projectId: request.projectId,
            refs: normalizeEvaluatorRefs(request.refs),
            flags: normalizeFlags(request.flags) ?? null,
        }),
    batchFn: async (requests, serializedKeys) => {
        const responseMap = new Map<string, EvaluatorDefinition[]>()
        const groups = new Map<
            string,
            {
                projectId: string
                flags: Record<string, boolean> | null
                entries: Array<{
                    serializedKey: string
                    refs: EvaluatorReferenceInput[]
                }>
            }
        >()

        requests.forEach((request, index) => {
            const normalizedRefs = normalizeEvaluatorRefs(request.refs ?? [])
            const normalizedFlags = normalizeFlags(request.flags)
            const groupKey = JSON.stringify({
                projectId: request.projectId,
                flags: normalizedFlags ?? null,
            })

            const entry = groups.get(groupKey)
            if (entry) {
                entry.entries.push({serializedKey: serializedKeys[index], refs: normalizedRefs})
            } else {
                groups.set(groupKey, {
                    projectId: request.projectId,
                    flags: normalizedFlags,
                    entries: [{serializedKey: serializedKeys[index], refs: normalizedRefs}],
                })
            }
        })

        for (const [, group] of groups) {
            const {projectId, flags, entries} = group
            const allRefs = normalizeEvaluatorRefs(entries.flatMap((entry) => entry.refs))

            let evaluatorDefinitions: EvaluatorDefinition[] = []

            if (projectId && (allRefs.length || flags)) {
                const payload: Record<string, any> = {}
                if (allRefs.length) {
                    payload.evaluator_refs = allRefs.map((ref) => ({
                        id: ref.id ?? undefined,
                        slug: ref.slug ?? undefined,
                    }))
                }
                if (flags) {
                    payload.evaluator = {flags}
                }

                const response = await axios.post(`/preview/simple/evaluators/query`, payload, {
                    params: {project_id: projectId},
                })
                const rawEvaluators = Array.isArray(response?.data?.evaluators)
                    ? response.data.evaluators
                    : []
                evaluatorDefinitions = rawEvaluators.map(toEvaluatorDefinition)
            }

            entries.forEach((entry) => {
                if (!entry.refs.length) {
                    responseMap.set(entry.serializedKey, evaluatorDefinitions)
                    return
                }

                const expectedKeys = new Set(
                    entry.refs.map((ref) => `${ref.id ?? ""}:${ref.slug ?? ""}`),
                )

                const filtered = evaluatorDefinitions.filter((definition) =>
                    expectedKeys.has(`${definition.id ?? ""}:${definition.slug ?? ""}`),
                )

                responseMap.set(entry.serializedKey, filtered)
            })
        }

        return responseMap
    },
})

const fetchEvaluators = async ({
    projectId,
    refs,
    flags,
}: {
    projectId: string
    refs: EvaluatorReferenceInput[]
    flags?: Record<string, boolean>
}): Promise<EvaluatorDefinition[]> => {
    if (!projectId) {
        return []
    }

    return evaluatorFetchBatcher({
        projectId,
        refs,
        flags: normalizeFlags(flags),
    })
}

export const previewEvaluatorsQueryAtomFamily = atomFamily(
    ({ids = [], refs = [], flags}: EvaluatorQueryArgs) =>
        atomWithQuery<EvaluatorDefinition[]>((get) => {
            const projectId = get(effectiveProjectIdAtom)
            const uniqueIds = Array.from(new Set(ids))
            const normalizedRefs = mergeEvaluatorRefs(uniqueIds, refs)

            return {
                queryKey: buildEvaluatorQueryKey(projectId ?? null, normalizedRefs, flags),
                enabled:
                    Boolean(projectId) &&
                    (normalizedRefs.length > 0 || (flags && Object.keys(flags).length > 0)),
                staleTime: 60_000,
                gcTime: 5 * 60 * 1000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!projectId) return []
                    return fetchEvaluators({projectId, refs: normalizedRefs, flags})
                },
            }
        }),
)

export const buildEvaluatorQueryKeyForIds = (projectId: string, ids: string[]) =>
    buildEvaluatorQueryKey(projectId, mergeEvaluatorRefs(ids))

export const evaluationEvaluatorsByRunQueryAtomFamily = atomFamily((runId: string | null) =>
    atomWithQuery<EvaluatorDefinition[]>((get) => {
        const projectId = get(effectiveProjectIdAtom)
        const runQuery = runId ? get(evaluationRunQueryAtomFamily(runId)) : undefined
        const evaluatorRefs = runQuery?.data
            ? normalizeEvaluatorRefs(
                  Object.values(runQuery.data.runIndex.steps ?? {}).map((step: any) => {
                      const ref = step?.refs?.evaluator ?? {}
                      const id =
                          typeof ref?.id === "string" && ref.id.length > 0 ? ref.id : undefined
                      const slug =
                          typeof ref?.slug === "string" && ref.slug.length > 0
                              ? ref.slug
                              : undefined
                      return {id, slug}
                  }),
              )
            : []

        return {
            queryKey: buildEvaluatorQueryKey(projectId ?? null, evaluatorRefs),
            enabled:
                Boolean(projectId && runId && evaluatorRefs.length > 0) && Boolean(runQuery?.data),
            staleTime: 60_000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            queryFn: async () => {
                if (!projectId || !runId || evaluatorRefs.length === 0) return []
                return fetchEvaluators({projectId, refs: evaluatorRefs})
            },
        }
    }),
)
