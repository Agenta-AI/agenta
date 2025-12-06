import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"

import {updateScenarioStatusCache} from "../metrics"
import {effectiveProjectIdAtom} from "../run"

import type {EvaluationScenarioRow, ScenarioRowsQueryResult, WindowingState} from "./types"

let queryRequestCounter = 0

interface ScenarioQueryKey {
    runId: string | null
    cursor: string | null
    limit: number
    offset?: number
    windowing?: WindowingState
}

const scenarioQueryKeyEquals = (a: ScenarioQueryKey, b: ScenarioQueryKey) =>
    a.runId === b.runId &&
    a.cursor === b.cursor &&
    a.limit === b.limit &&
    (a.offset ?? 0) === (b.offset ?? 0) &&
    (a.windowing?.next ?? null) === (b.windowing?.next ?? null) &&
    (a.windowing?.stop ?? null) === (b.windowing?.stop ?? null)

interface WindowingResponseMeta {
    next?: string | null
    start?: string | null
    stop?: string | null
    limit?: number | null
    order?: string | null
    offset?: number | null
    total?: number | null
}

interface ScenariosResponse {
    count?: number
    next?: string | null
    scenarios: Record<string, unknown>[]
    windowing?: WindowingResponseMeta | null
}

const parseNextOffset = (nextUrl?: string | null): number | null => {
    if (!nextUrl) return null
    try {
        const url = new URL(
            nextUrl,
            typeof window === "undefined" ? "http://localhost" : window.location.origin,
        )
        const offsetParam = url.searchParams.get("offset")
        if (!offsetParam) return null
        const parsed = Number(offsetParam)
        return Number.isFinite(parsed) ? parsed : null
    } catch {
        return null
    }
}

const buildWindowingPayload = ({
    cursor,
    limit,
    windowing,
    order = "ascending",
}: {
    cursor: string | null
    limit: number
    windowing?: WindowingState | null
    order?: "ascending" | "descending"
}) => {
    const payload: Record<string, unknown> = {
        limit,
        order: windowing?.order ?? order,
    }

    const nextValue = windowing?.next ?? cursor ?? undefined
    if (nextValue) {
        payload.next = nextValue
    }

    if (windowing?.stop) {
        payload.stop = windowing.stop
    }

    return payload
}

const normalizeWindowing = ({
    responseWindowing,
    fallbackCursor,
    limit,
}: {
    responseWindowing?: WindowingResponseMeta | null
    fallbackCursor: string | null
    limit: number
}): WindowingState | null => {
    const nextValue =
        (responseWindowing?.next as string | null | undefined) ?? fallbackCursor ?? null
    if (!nextValue) {
        return null
    }

    const normalized = {
        next: nextValue,
        stop: (responseWindowing?.stop as string | null | undefined) ?? null,
        order: (responseWindowing?.order as string | null | undefined) ?? "ascending",
        limit:
            typeof responseWindowing?.limit === "number" && responseWindowing.limit > 0
                ? responseWindowing.limit
                : limit,
    }

    return normalized
}

export interface ScenarioRowsFetchParams {
    projectId: string
    runId: string
    cursor: string | null
    limit: number
    offset: number
    windowing?: WindowingState | null
    order?: "ascending" | "descending"
}

export const fetchEvaluationScenarioWindow = async ({
    projectId,
    runId,
    cursor,
    limit,
    offset,
    windowing,
    order = "ascending",
}: ScenarioRowsFetchParams): Promise<ScenarioRowsQueryResult> => {
    const payload = {
        scenario: {
            run_id: runId,
        },
        windowing: buildWindowingPayload({cursor, limit, windowing, order}),
    }

    const response = await axios.post<ScenariosResponse>(
        `/preview/evaluations/scenarios/query`,
        payload,
        {
            params: {
                project_id: projectId,
            },
        },
    )

    const rawScenarios = Array.isArray(response.data?.scenarios) ? response.data.scenarios : []

    const rows: EvaluationScenarioRow[] = rawScenarios.map((scenario) => {
        const camel = snakeToCamelCaseKeys(scenario) as {
            id: string
            status: string
            createdAt: string
            updatedAt: string
            createdById?: string
            updatedById?: string
            testcaseId?: string
            timestamp?: string
        }

        const testcaseId = (() => {
            const direct = (camel as any)?.testcaseId ?? (camel as any)?.testcase_id
            if (typeof direct === "string" && direct.length > 0) return direct
            const nested = (camel as any)?.testcase ?? (scenario as any)?.testcase
            if (nested && typeof nested === "object") {
                const nestedId =
                    nested?.id ?? nested?._id ?? nested?.testcaseId ?? nested?.testcase_id
                if (typeof nestedId === "string" && nestedId.length > 0) return nestedId
            }
            const raw = (scenario as any)?.testcase_id ?? (scenario as any)?.testcaseId
            if (typeof raw === "string" && raw.length > 0) return raw
            return undefined
        })()

        // Extract timestamp for online evaluations (batch grouping)
        const timestamp = (camel as any)?.timestamp ?? (scenario as any)?.timestamp ?? null

        return {
            id: camel.id,
            status: camel.status,
            createdAt: camel.createdAt,
            updatedAt: camel.updatedAt,
            createdById: camel.createdById,
            updatedById: camel.updatedById,
            testcaseId: testcaseId ?? null,
            timestamp,
        }
    })

    // Populate scenario status cache for metric refresh logic
    // This allows the metric batcher to detect terminal state scenarios with missing metrics
    if (rows.length > 0) {
        updateScenarioStatusCache(rows)
    }

    const responseWindowing = response.data?.windowing ?? {}
    const lastRowId = rows.length ? (rows[rows.length - 1]?.id ?? null) : null
    const apiCursor = (responseWindowing?.next as string | null | undefined) ?? null
    const fallbackCursor = rows.length === limit ? lastRowId : null
    const nextCursor = apiCursor ?? fallbackCursor

    const hasMore = Boolean(nextCursor)

    const parsedNextOffset = parseNextOffset(response.data?.next)
    const baseOffset =
        typeof responseWindowing?.offset === "number" ? responseWindowing.offset : offset
    const computedNextOffset = baseOffset + rows.length
    const nextOffset = hasMore ? (parsedNextOffset ?? computedNextOffset) : null

    const totalCountFromApi = response.data?.count ?? responseWindowing?.total
    const totalCount = (() => {
        if (typeof totalCountFromApi === "number" && totalCountFromApi >= rows.length) {
            return totalCountFromApi
        }
        if (hasMore) {
            return null
        }
        return computedNextOffset
    })()

    const nextWindowing = normalizeWindowing({
        responseWindowing,
        fallbackCursor,
        limit,
    })

    return {
        rows,
        totalCount,
        hasMore,
        nextOffset,
        nextCursor,
        nextWindowing,
    }
}

export const tableScenarioRowsQueryAtomFamily = atomFamily(
    ({runId, cursor, limit, offset = 0, windowing}: ScenarioQueryKey) =>
        atomWithQuery<ScenarioRowsQueryResult>((get) => {
            const projectId = get(effectiveProjectIdAtom)

            const enabled = Boolean(runId && projectId)

            return {
                queryKey: [
                    "eval-table",
                    "scenarios",
                    runId,
                    projectId,
                    cursor,
                    limit,
                    offset,
                    windowing?.next ?? null,
                    windowing?.stop ?? null,
                ],
                enabled,
                staleTime: 15_000,
                gcTime: 60_000,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                queryFn: async () => {
                    if (!runId) {
                        throw new Error("tableScenarioRowsQueryAtomFamily requires a run id")
                    }

                    const requestId = `${runId}:${cursor ?? "root"}:${queryRequestCounter++}`

                    const result = await fetchEvaluationScenarioWindow({
                        projectId,
                        runId,
                        cursor,
                        limit,
                        offset,
                        windowing,
                    })

                    return result
                },
            }
        }),
    scenarioQueryKeyEquals,
)

export const tableScenarioIdsAtomFamily = atomFamily(
    (params: ScenarioQueryKey) =>
        atom(
            (get) =>
                get(tableScenarioRowsQueryAtomFamily(params)).data?.rows?.map((row) => row.id) ??
                [],
        ),
    scenarioQueryKeyEquals,
)
