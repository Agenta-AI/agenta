import {buildNodeTree, observabilityTransformer} from "@/lib/helpers/observability_helpers"
import {fetchAllTraces} from "@/services/observability/core"
import {
    _AgentaRootsResponse,
    AgentaNodeDTO,
    AgentaRootsDTO,
    AgentaTreeDTO,
} from "@/services/observability/types"
import React, {createContext, PropsWithChildren, useContext, useEffect, useState} from "react"
import {useRouter} from "next/router"

type ObservabilityContextType = {
    traces: _AgentaRootsResponse[]
    count: number
    isLoading: boolean
    fetchTraces: (queries?: string) => void
}

const initialValues: ObservabilityContextType = {
    traces: [],
    count: 0,
    isLoading: false,
    fetchTraces: () => {},
}

export const ObservabilityContext = createContext<ObservabilityContextType>(initialValues)

export const useObservabilityData = () => useContext(ObservabilityContext)

const observabilityContextValues = {...initialValues}

export const getObservabilityValues = () => observabilityContextValues

const ObservabilityContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const router = useRouter()
    const appId = router.query.app_id as string
    const [traces, setTraces] = useState<_AgentaRootsResponse[]>([])
    const [traceCount, setTraceCount] = useState(0)
    const [isLoading, setIsLoading] = useState(true)

    const fetchTraces = async (queries?: string) => {
        try {
            setIsLoading(true)
            const data = await fetchAllTraces({appId, queries: queries || ""})

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
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchTraces("focus=tree&size=10&page=1")
    }, [appId])

    observabilityContextValues.traces = traces
    observabilityContextValues.isLoading = isLoading
    observabilityContextValues.fetchTraces = fetchTraces
    observabilityContextValues.count = traceCount

    return (
        <ObservabilityContext.Provider
            value={{
                traces,
                isLoading,
                fetchTraces,
                count: traceCount || 0,
            }}
        >
            {children}
        </ObservabilityContext.Provider>
    )
}

export default ObservabilityContextProvider
