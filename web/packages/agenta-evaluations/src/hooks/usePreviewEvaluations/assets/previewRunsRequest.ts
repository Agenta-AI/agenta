import {queryEvaluationRunsList} from "@agenta/entities/evaluationRun"

import {snakeToCamelCaseKeys} from "../casing"
import type {QueryWindowingPayload, RunFlagsFilter} from "../previewTypes"

export interface PreviewRunsRequestParams {
    projectId: string
    appId?: string | null
    searchQuery?: string | null
    references?: unknown[] | null
    flags?: RunFlagsFilter | Record<string, unknown> | null
    statuses?: string[] | null
    evaluationTypes?: string[] | null
    windowing?: QueryWindowingPayload | null
}

export interface PreviewRunsResponse {
    runs: unknown[]
    count: number
    windowing?: QueryWindowingPayload | null
}

const inflightCache = new Map<string, Promise<PreviewRunsResponse>>()
const resolvedCache = new Map<string, {timestamp: number; data: PreviewRunsResponse}>()

const CACHE_TTL = 10_000 // 10 seconds aligns with table polling rhythm

/**
 * Clears the preview runs cache to force fresh data on next fetch.
 * Call this after creating/updating/deleting evaluation runs.
 */
export const clearPreviewRunsCache = () => {
    resolvedCache.clear()
    inflightCache.clear()
}

const normalizeParams = ({
    projectId,
    appId,
    searchQuery,
    references,
    flags,
    statuses,
    evaluationTypes,
    windowing,
}: PreviewRunsRequestParams) => ({
    projectId,
    appId: appId ?? null,
    searchQuery: searchQuery ?? null,
    references: Array.isArray(references) ? references : [],
    flags: normalizeFlags(flags),
    statuses: normalizeStatuses(statuses),
    evaluationTypes: normalizeEvaluationTypes(evaluationTypes),
    windowing: windowing
        ? {
              next: windowing.next ?? null,
              limit: windowing.limit ?? null,
              order: windowing.order ?? null,
              newest: windowing.newest ?? null,
              oldest: windowing.oldest ?? null,
              interval: windowing.interval ?? null,
              rate: windowing.rate ?? null,
          }
        : null,
})

const normalizeFlags = (flags: RunFlagsFilter | Record<string, unknown> | null | undefined) => {
    if (!flags) return null
    const entries = Object.entries(flags).filter(([, value]) => value !== undefined)
    if (!entries.length) return null
    // sort keys for stable cache key
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

const normalizeStatuses = (statuses: string[] | null | undefined) => {
    if (!Array.isArray(statuses) || statuses.length === 0) return null
    const unique = Array.from(new Set(statuses.map((status) => status ?? "")))
        .filter((status) => status && status.length > 0)
        .sort()
    return unique.length ? unique : null
}

const normalizeEvaluationTypes = (types: string[] | null | undefined) => {
    if (!Array.isArray(types) || types.length === 0) return null
    const unique = Array.from(new Set(types.map((value) => value ?? "")))
        .filter((value) => value && value.length > 0)
        .map((value) => value.toLowerCase())
        .sort()
    return unique.length ? unique : null
}

/**
 * Map the request params to the filters the backend `query_runs` actually supports.
 * `searchQuery` and `evaluationTypes` are deliberately omitted — the backend has no such
 * filters (they were silently dropped); free-text/kind filtering is done client-side.
 */
const buildListArgs = (params: PreviewRunsRequestParams) => {
    const refs = Array.isArray(params.references)
        ? params.references.filter(
              (entry): entry is Record<string, unknown> =>
                  !!entry && Object.keys(entry as object).length > 0,
          )
        : []
    const windowing = params.windowing
        ? {
              next: params.windowing.next ?? undefined,
              limit: params.windowing.limit ?? undefined,
              order: params.windowing.order ?? undefined,
              newest: params.windowing.newest ?? undefined,
              oldest: params.windowing.oldest ?? undefined,
              interval: params.windowing.interval ?? undefined,
              rate: params.windowing.rate ?? undefined,
          }
        : null
    return {
        projectId: params.projectId,
        appId: params.appId ?? null,
        references: refs.length ? refs : null,
        flags: normalizeFlags(params.flags),
        statuses: normalizeStatuses(params.statuses),
        windowing,
    }
}

export const fetchPreviewRunsShared = async (
    params: PreviewRunsRequestParams,
): Promise<PreviewRunsResponse> => {
    const normalized = normalizeParams(params)
    const cacheKey = JSON.stringify(normalized)

    const cachedResult = resolvedCache.get(cacheKey)
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL) {
        return cachedResult.data
    }

    const inflight = inflightCache.get(cacheKey)
    if (inflight) {
        return inflight
    }

    // Fern-backed list query (POST /evaluations/runs/query) — same endpoint the package
    // by-ids query uses, with the supported filter set.
    const request = queryEvaluationRunsList(buildListArgs(params))
        .then((res) => {
            const runs = Array.isArray(res.runs)
                ? res.runs.map((run: Record<string, unknown>) => snakeToCamelCaseKeys(run))
                : []

            const result: PreviewRunsResponse = {
                runs,
                count: res.count ?? runs.length,
                windowing: (res.windowing as QueryWindowingPayload | null) ?? null,
            }

            resolvedCache.set(cacheKey, {timestamp: Date.now(), data: result})
            return result
        })
        .finally(() => {
            inflightCache.delete(cacheKey)
        })

    inflightCache.set(cacheKey, request)
    return request
}
