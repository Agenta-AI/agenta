import {buildNodeTree, observabilityTransformer} from "@/lib/helpers/observability_helpers"
import {fetchAllTraces} from "@/services/observability/core"
import {
    _AgentaRootsResponse,
    AgentaNodeDTO,
    AgentaRootsDTO,
    AgentaTreeDTO,
} from "@/services/observability/types"
import React, {createContext, PropsWithChildren, useContext, useEffect, useState} from "react"

type ObservabilityContextType = {
    traces: _AgentaRootsResponse[]
    isLoading: boolean
    fetchTraces: () => void
}

const initialValues: ObservabilityContextType = {
    traces: [],
    isLoading: false,
    fetchTraces: () => {},
}

export const ObservabilityContext = createContext<ObservabilityContextType>(initialValues)

export const useObservabilityData = () => useContext(ObservabilityContext)

const observabilityContextValues = {...initialValues}

export const getObservabilityValues = () => observabilityContextValues

const ObservabilityContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [traces, setTraces] = useState<_AgentaRootsResponse[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const fetchTraces = async () => {
        try {
            setIsLoading(true)
            const data = await fetchAllTraces()

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
        } catch (error) {
            console.error(error)
            console.error("Failed to fetch traces:", error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchTraces()
    }, [])

    observabilityContextValues.traces = traces
    observabilityContextValues.isLoading = isLoading
    observabilityContextValues.fetchTraces = fetchTraces

    return (
        <ObservabilityContext.Provider
            value={{
                traces,
                isLoading,
                fetchTraces,
            }}
        >
            {children}
        </ObservabilityContext.Provider>
    )
}

export default ObservabilityContextProvider
