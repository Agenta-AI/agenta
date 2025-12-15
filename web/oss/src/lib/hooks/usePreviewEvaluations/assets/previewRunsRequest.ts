import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"

import type {QueryWindowingPayload} from "../../../../services/onlineEvaluations/api"

import {primePreviewRunCache} from "./previewRunBatcher"

export interface PreviewRunsRequestParams {
    projectId: string
    appId?: string | null
    searchQuery?: string | null
    references?: any[] | null
    flags?: Record<string, any> | null
    statuses?: string[] | null
    evaluationTypes?: string[] | null
    windowing?: QueryWindowingPayload | null
}

export interface PreviewRunsResponse {
    runs: any[]
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

const normalizeFlags = (flags: Record<string, any> | null | undefined) => {
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

const buildPayload = ({
    searchQuery,
    references,
    flags,
    statuses,
    evaluationTypes,
    windowing,
}: PreviewRunsRequestParams) => {
    const payload: Record<string, any> = {}
    const runPayload: Record<string, any> = {}
    const normalizedReferences = Array.isArray(references)
        ? references.filter(
              (entry): entry is Record<string, any> => !!entry && Object.keys(entry).length > 0,
          )
        : []
    if (normalizedReferences.length) {
        runPayload.references = normalizedReferences
    }
    if (searchQuery) {
        runPayload.search = searchQuery
    }
    const normalizedFlags = normalizeFlags(flags)
    if (normalizedFlags) {
        runPayload.flags = normalizedFlags
    }
    const normalizedStatuses = normalizeStatuses(statuses)
    if (normalizedStatuses) {
        runPayload.statuses = normalizedStatuses
    }
    const normalizedTypes = normalizeEvaluationTypes(evaluationTypes)
    if (normalizedTypes) {
        runPayload.evaluation_kinds = normalizedTypes
    }
    if (Object.keys(runPayload).length > 0) {
        payload.run = runPayload
    }
    if (windowing) {
        payload.windowing = {
            next: windowing.next ?? undefined,
            limit: windowing.limit ?? undefined,
            order: windowing.order ?? undefined,
            newest: windowing.newest ?? undefined,
            oldest: windowing.oldest ?? undefined,
            interval: windowing.interval ?? undefined,
            rate: windowing.rate ?? undefined,
        }
    }
    return payload
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

    const payload = buildPayload(params)
    const queryParams: Record<string, string> = {project_id: params.projectId}
    if (params.appId) {
        queryParams.app_id = params.appId
    }

    const request = axios
        .post(`/preview/evaluations/runs/query`, payload, {
            params: queryParams,
        })
        .then((response) => {
            primePreviewRunCache(params.projectId, response?.data?.runs)

            const runs = Array.isArray(response.data?.runs)
                ? response.data.runs.map((run: any) => snakeToCamelCaseKeys(run))
                : []

            const result: PreviewRunsResponse = {
                runs,
                count: response.data?.count ?? runs.length,
                windowing: response.data?.windowing ?? null,
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
