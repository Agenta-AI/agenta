import type {_AgentaRootsResponse} from "@/services/observability/types"
import React, {createContext, PropsWithChildren, useContext, useEffect, useState} from "react"
import {useRouter} from "next/router"
import {SortResult} from "@/components/Filters/Sort"
import {Filter} from "@/lib/Types"
import {useTraces} from "@/services/observability/hooks/useTraces"

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
    // query states
    const [searchQuery, setSearchQuery] = useState("")
    const [traceTabs, setTraceTabs] = useState<TraceTabTypes>("tree")
    const [filters, setFilters] = useState<Filter[]>(
        appId
            ? [{key: "refs.application.id", operator: "is", value: appId, isPermanent: true}]
            : [],
    )
    const [sort, setSort] = useState<SortResult>({} as SortResult)
    const [pagination, setPagination] = useState({page: 1, size: 50})

    const {
        data,
        isLoading,
        mutate: fetchTraces,
        error,
    } = useTraces(
        {
            pagination,
            sort,
            filters,
            traceTabs,
        },
        appId,
    )
    const {traces, traceCount} = data || {}

    const clearQueryStates = () => {
        setSearchQuery("")
        setTraceTabs("tree")
        setFilters([])
        setSort({} as SortResult)
        setPagination({page: 1, size: 10})
    }

    observabilityContextValues.traces = traces || []
    observabilityContextValues.isLoading = isLoading
    observabilityContextValues.fetchTraces = fetchTraces
    observabilityContextValues.count = traceCount

    return (
        <ObservabilityContext.Provider
            value={{
                traces: traces || [],
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
