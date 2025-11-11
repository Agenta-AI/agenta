import axios from "@/oss/lib/api/assets/axiosConfig"
import {delay, pickRandom} from "@/oss/lib/helpers/utils"
import {GenericObject, WithPagination} from "@/oss/lib/Types"
import {Generation, GenerationDetails, Trace, TracingDashboardData} from "@/oss/lib/types_ee"
import {getProjectValues} from "@/oss/state/project"

import {tracingToGeneration} from "./helper"
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
    const {projectId} = getProjectValues()

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

    const response = await axios.get(`/observability/spans?project_id=${projectId}`, {
        params: {app_id: appId, type: "generation", ...params},
    })
    return response.data as WithPagination<Generation>
}

export const fetchGeneration = async (generationId: string) => {
    const {projectId} = getProjectValues()

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
        `/observability/spans/${generationId}?project_id=${projectId}`,
        {
            params: {type: "generation"},
        },
    )
    return response.data as GenerationDetails
}

export const fetchGenerationsDashboardData = async (
    appId: string | null | undefined,
    _options: {
        range: string
        environment?: string
        variant?: string
        projectId?: string
        signal?: AbortSignal
    },
) => {
    const {projectId: propsProjectId, signal, ...options} = _options
    const {projectId: _projectId} = getProjectValues()
    const projectId = propsProjectId || _projectId

    const {range} = options

    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
    }

    const responseTracing = await axios.post(
        `/preview/tracing/spans/analytics?project_id=${projectId}`,
        {
            focus: "trace",
            interval: 720,
            filter: {
                conditions: [
                    {
                        field: "references",
                        operator: "in",
                        value: [
                            {
                                id: appId,
                            },
                        ],
                    },
                ],
            },
        },
    )

    const valTracing = responseTracing.data as TracingDashboardData
    return tracingToGeneration(valTracing, range)
}

export const deleteGeneration = async (
    generationIds: string[],
    type = "generation",
    ignoreAxiosError = true,
) => {
    const {projectId} = getProjectValues()

    await axios.delete(`/observability/spans?project_id=${projectId}`, {
        data: generationIds,
        _ignoreError: ignoreAxiosError,
    } as any)
    return true
}

export const fetchAllTraces = async (appId: string, options?: Partial<TableParams>) => {
    const {projectId} = getProjectValues()

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
    const response = await axios.get(`/observability/traces?project_id=${projectId}`, {
        params: {app_id: appId, type: "generation", ...params},
    })
    return response.data as WithPagination<Trace>
}
