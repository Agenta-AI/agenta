import {fetchAllTraces} from "@/services/observability/core"
import {
    _AgentaRootsResponse,
    AgentaNodeDTO,
    AgentaRootsDTO,
    AgentaTreeDTO,
} from "@/services/observability/types"
import {useEffect, useState} from "react"
import {buildNodeTree, observabilityTransformer} from "../helpers/observability_helpers"

export const useTraces = () => {
    const [traces, setTraces] = useState<_AgentaRootsResponse[]>([])
    const [traceCount, setTraceCount] = useState(0)
    const [isLoadingTraces, setIsLoadingTraces] = useState(true)

    const fetchTraces = async (queries?: string) => {
        try {
            setIsLoadingTraces(true)
            const data = await fetchAllTraces(queries || "")

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

            setTraces(transformedTraces)
            setTraceCount(data?.count)
        } catch (error) {
            console.error(error)
            console.error("Failed to fetch traces:", error)
        } finally {
            setIsLoadingTraces(false)
        }
    }

    useEffect(() => {
        fetchTraces("?focus=tree&size=10&page=1")
    }, [])

    return {traces, isLoadingTraces, count: traceCount || 0, fetchTraces}
}
