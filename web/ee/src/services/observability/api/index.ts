import dayjs from "dayjs"
import meanBy from "lodash/meanBy"
import random from "lodash/random"
import round from "lodash/round"
import sumBy from "lodash/sumBy"
import Router from "next/router"

import {getCurrentProject} from "@/oss/contexts/project.context"
import axios from "@/oss/lib/api/assets/axiosConfig"
import {delay, pickRandom} from "@/oss/lib/helpers/utils"
import {GenericObject, WithPagination} from "@/oss/lib/Types"
import {
    Generation,
    GenerationDashboardData,
    GenerationDetails,
    Trace,
    TraceDetails,
} from "@/oss/lib/types_ee"

import {ObservabilityMock} from "./mock"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

const mock = false

interface TableParams {
    pagination?: {
        page: number
        pageSize: number
    }
    sorters?: GenericObject
    filters?: GenericObject
}

function tableParamsToApiParams(options?: Partial<TableParams>) {
    const {page = 1, pageSize = 20} = options?.pagination || {}
    const res: GenericObject = {page, pageSize}
    if (options?.sorters) {
        Object.entries(options.sorters).forEach(
            ([key, val]) => (res[key] = val === "ascend" ? "asc" : "desc"),
        )
    }
    if (options?.filters) {
        Object.entries(options.filters).forEach(([key, val]) => (res[key] = val))
    }
    return res
}

const generations = pickRandom(ObservabilityMock.generations, 100).map((item, ix) => ({
    ...item,
    id: ix + 1 + "",
}))

export const fetchAllGenerations = async (appId: string, options?: Partial<TableParams>) => {
    const {projectId} = getCurrentProject()

    const params = tableParamsToApiParams(options)
    if (mock) {
        const {page, pageSize} = params
        await delay(800)
        return {
            data: generations.slice((page - 1) * pageSize, page * pageSize),
            total: generations.length,
            page,
            pageSize,
        } as WithPagination<Generation>
    }

    const response = await axios.get(`/api/observability/spans?project_id=${projectId}`, {
        params: {app_id: appId, type: "generation", ...params},
    })
    return response.data as WithPagination<Generation>
}

export const fetchGeneration = async (generationId: string) => {
    const {projectId} = getCurrentProject()

    if (mock) {
        await delay(800)
        const generation = generations.find((item) => item.id === generationId)
        if (!generation) throw new Error("not found!")

        return {
            ...generation,
            ...ObservabilityMock.generationDetail,
        } as GenerationDetails
    }

    const response = await axios.get(
        `/api/observability/spans/${generationId}?project_id=${projectId}`,
        {
            params: {type: "generation"},
        },
    )
    return response.data as GenerationDetails
}

export const fetchGenerationsDashboardData = async (
    appId: string,
    options: {
        range: string
        environment?: string
        variant?: string
    },
) => {
    const {projectId} = getCurrentProject()

    const {range, environment, variant} = options
    if (mock) {
        await delay(1200)
        const startTs = Date.now()
        const endTs = dayjs()
            .subtract(1, range === "24_hours" ? "day" : range === "7_days" ? "week" : "month")
            .valueOf()

        const data = ObservabilityMock.dashboardData().filter(
            (item) =>
                (item as any).timestamp >= endTs &&
                (item as any).timestamp <= startTs &&
                (!environment || item.enviornment === environment),
        )

        const successCount = sumBy(data, "success_count")
        const failureCount = sumBy(data, "failure_count")
        return {
            data: data.map((item) => ({
                ...item,
                timestamp: dayjs(item.timestamp).format(
                    range === "24_hours" ? "h:mm a" : range === "7_days" ? "ddd" : "D MMM",
                ),
            })) as any,
            total_count: successCount + failureCount,
            failure_rate: round(failureCount / (successCount + failureCount), 2),
            total_cost: sumBy(data, "cost"),
            avg_cost: meanBy(data, "cost"),
            avg_latency: meanBy(data, "latency"),
            total_tokens: sumBy(data, "total_tokens"),
            avg_tokens: meanBy(data, "total_tokens"),
        } as GenerationDashboardData
    }
    const response = await axios.get(`/api/observability/v1/analytics?project_id=${projectId}`, {
        params: {
            app_id: appId,
            timeRange: range,
            environment,
            variant,
            format: "legacy",
        },
    })
    const val = response.data as GenerationDashboardData
    val.data = val.data.map((item) => ({
        ...item,
        timestamp: dayjs(item.timestamp).format(
            range === "24_hours" ? "h:mm a" : range === "7_days" ? "ddd" : "D MMM",
        ),
    }))
    return val
}

export const deleteGeneration = async (
    generationIds: string[],
    type = "generation",
    ignoreAxiosError = true,
) => {
    const {projectId} = getCurrentProject()

    await axios.delete(`/api/observability/spans?project_id=${projectId}`, {
        data: generationIds,
        _ignoreError: ignoreAxiosError,
    } as any)
    return true
}

export const fetchAllTraces = async (appId: string, options?: Partial<TableParams>) => {
    const {projectId} = getCurrentProject()

    const params = tableParamsToApiParams(options)
    if (mock) {
        const {page, pageSize} = params
        await delay(800)
        return {
            data: generations.slice((page - 1) * pageSize, page * pageSize),
            total: generations.length,
            page,
            pageSize,
        } as WithPagination<Trace>
    }
    const response = await axios.get(`/api/observability/traces?project_id=${projectId}`, {
        params: {app_id: appId, type: "generation", ...params},
    })
    return response.data as WithPagination<Trace>
}
