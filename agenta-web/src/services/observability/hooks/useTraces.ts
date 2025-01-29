import {useCallback} from "react"
import {fetchAllTraces} from "../core"
import {_AgentaRootsResponse, AgentaRootsDTO, AgentaTreeDTO} from "../types"
import {buildNodeTree, observabilityTransformer} from "@/lib/helpers/observability_helpers"
import useSWR from "swr"

export const useTraces = ({pagination, sort, filters, traceTabs}) => {
    const generateTraceQueryString = useCallback(() => {
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
    }, [])
    const fetcher = async () => {
        const queries = generateTraceQueryString()
        const data = await fetchAllTraces(queries)

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

    const swr = useSWR("traces", fetcher, {
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
    })

    return swr
}
