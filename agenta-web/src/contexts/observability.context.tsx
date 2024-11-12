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
import {SortResult} from "@/components/Filters/Sort"
import {Filter} from "@/lib/Types"

type ObservabilityContextType = {
    traces: _AgentaRootsResponse[]
    count: number
    isLoading: boolean
    fetchTraces: () => void
    clearQueryStates: () => void
    searchQuery: string
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>
    traceTabs: TraceTabTypes
    setTraceTabs: React.Dispatch<React.SetStateAction<TraceTabTypes>>
    filters: Filter[]
    setFilters: React.Dispatch<React.SetStateAction<Filter[]>>
    sort: SortResult
    setSort: React.Dispatch<React.SetStateAction<SortResult>>
    pagination: {page: number; size: number}
    setPagination: React.Dispatch<React.SetStateAction<{page: number; size: number}>>
}

type TraceTabTypes = "tree" | "node" | "chat"

const initialValues: ObservabilityContextType = {
    traces: [],
    count: 0,
    isLoading: false,
    fetchTraces: () => {},
    clearQueryStates: () => {},
    searchQuery: "",
    setSearchQuery: () => {},
    traceTabs: "tree",
    setTraceTabs: () => {},
    filters: [],
    setFilters: () => {},
    sort: {type: "standard", sorted: ""},
    setSort: () => {},
    pagination: {page: 1, size: 10},
    setPagination: () => {},
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
    // query states
    const [searchQuery, setSearchQuery] = useState("")
    const [traceTabs, setTraceTabs] = useState<TraceTabTypes>("tree")
    const [filters, setFilters] = useState<Filter[]>(
        appId
            ? [{key: "refs.application.id", operator: "is", value: appId, isPermanent: true}]
            : [],
    )
    const [sort, setSort] = useState<SortResult>({} as SortResult)
    const [pagination, setPagination] = useState({page: 1, size: 10})

    const fetchTraces = async () => {
        try {
            setIsLoading(true)

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

            setTraces(transformedTraces)
            setTraceCount(data?.count)
        } catch (error) {
            console.error(error)
            console.error("Failed to fetch traces:", error)
        } finally {
            setIsLoading(false)
        }
    }

    const generateTraceQueryString = () => {
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
    }

    const clearQueryStates = () => {
        setSearchQuery("")
        setTraceTabs("tree")
        setFilters([])
        setSort({} as SortResult)
        setPagination({page: 1, size: 10})
    }

    useEffect(() => {
        fetchTraces()
    }, [appId, filters, traceTabs, sort, pagination])

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
                clearQueryStates,
                searchQuery,
                setSearchQuery,
                traceTabs,
                setTraceTabs,
                filters,
                setFilters,
                sort,
                setSort,
                pagination,
                setPagination,
            }}
        >
            {children}
        </ObservabilityContext.Provider>
    )
}

export default ObservabilityContextProvider
