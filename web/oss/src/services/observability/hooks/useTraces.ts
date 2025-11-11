import {useEffect, useMemo} from "react"

import useSWR, {preload} from "swr"

import {buildNodeTree, observabilityTransformer} from "@/oss/lib/helpers/observability_helpers"

import {fetchAllTraces} from "../core"
import {_AgentaRootsResponse, AgentaNodeDTO, AgentaRootsDTO, AgentaTreeDTO} from "../types"

export const useTraces = (
    {
        pagination,
        sort,
        filters,
        traceTabs,
        autoPrefetch,
        waitUntil,
    }: {
        pagination: {size: number; page: number}
        sort: {type: string; sorted: string; customRange?: {startTime: string; endTime: string}}
        filters: any[]
        traceTabs: string
        autoPrefetch?: boolean
        waitUntil?: boolean
    },
    appId: string,
) => {
    const queryParams = useMemo(() => {
        const params: Record<string, any> = {
            size: pagination.size,
            page: pagination.page,
            focus: traceTabs === "chat" ? "node" : traceTabs,
        }

        if (filters.length > 0) {
            const sanitizedFilters = filters.map(({isPermanent, ...rest}) => rest)

            params.filtering = JSON.stringify({conditions: sanitizedFilters})
        }

        if (sort) {
            if (sort.type === "standard") {
                params.oldest = sort.sorted
            } else if (
                sort.type === "custom" &&
                (sort.customRange?.startTime || sort.customRange?.endTime)
            ) {
                const {startTime, endTime} = sort.customRange

                if (startTime) params.oldest = startTime
                if (endTime) params.newest = endTime
            }
        }

        return params
    }, [traceTabs, pagination.size, pagination.page, filters, sort])

    const fetcher = async () => {
        const data = await fetchAllTraces(queryParams, appId)

        const transformedTraces: _AgentaRootsResponse[] = []

        if (data?.roots) {
            transformedTraces.push(
                ...data.roots.flatMap((item: AgentaRootsDTO) =>
                    observabilityTransformer(item.trees[0]),
                ),
            )
        }

        if (data?.trees) {
            transformedTraces.push(
                ...data.trees.flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)),
            )
        }

        if (data?.nodes) {
            transformedTraces.push(
                ...data.nodes
                    .flatMap((node: AgentaNodeDTO) => buildNodeTree(node))
                    .flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)),
            )
        }

        return {
            traces: transformedTraces,
            traceCount: data?.count,
        }
    }

    const prefetchPage = async (pageNumber: number) => {
        const nextParams = {
            ...queryParams,
            page: pageNumber,
        }
        const key = ["traces", appId, JSON.stringify(nextParams)]
        await preload(key, async () => {
            const data = await fetchAllTraces(nextParams, appId)

            const transformedTraces: _AgentaRootsResponse[] = []

            if (data?.roots) {
                transformedTraces.push(
                    ...data.roots.flatMap((item: AgentaRootsDTO) =>
                        observabilityTransformer(item.trees[0]),
                    ),
                )
            }

            if (data?.trees) {
                transformedTraces.push(
                    ...data.trees.flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)),
                )
            }

            if (data?.nodes) {
                transformedTraces.push(
                    ...data.nodes
                        .flatMap((node: AgentaNodeDTO) => buildNodeTree(node))
                        .flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)),
                )
            }

            return {
                traces: transformedTraces,
                traceCount: data?.count,
            }
        })
    }

    useEffect(() => {
        if (autoPrefetch && !waitUntil) {
            prefetchPage(pagination.page + 1)
        }
    }, [autoPrefetch, pagination.page, JSON.stringify(queryParams), appId, waitUntil])

    const swrKey = waitUntil ? null : ["traces", appId, JSON.stringify(queryParams)]
    const swr = useSWR(swrKey, fetcher, {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
    })

    return swr
}
