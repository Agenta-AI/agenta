// @ts-nocheck
import {createContext, PropsWithChildren, useContext, useMemo, useState, useEffect} from "react"

import {useRouter} from "next/router"

import {SortResult} from "@/oss/components/Filters/Sort"
import {Filter} from "@/oss/lib/Types"
import {useTraces} from "@/oss/services/observability/hooks/useTraces"

import useAnnotations from "../lib/hooks/useAnnotations"
import {attachAnnotationsToTraces} from "../lib/hooks/useAnnotations/assets/helpers"
import {AnnotationDto} from "../lib/hooks/useAnnotations/types"
import {TracesWithAnnotations} from "../services/observability/types"

interface ObservabilityContextType {
    traces: TracesWithAnnotations[]
    annotations: AnnotationDto[]
    count: number
    isLoading: boolean
    fetchTraces: () => void
    fetchAnnotations: () => void
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
    navigateToPage: (newPage: number) => Promise<void>
}

type TraceTabTypes = "tree" | "node" | "chat"

const initialValues: ObservabilityContextType = {
    traces: [],
    annotations: [],
    count: 0,
    isLoading: false,
    fetchTraces: () => {},
    fetchAnnotations: () => {},
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
    navigateToPage: () => {},
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
    } = useTraces(
        {
            pagination,
            sort,
            filters,
            traceTabs,
            autoPrefetch: true,
        },
        appId,
    )
    const navigateToPage = (newPage: number) => {
        setPagination((prev) => ({...prev, page: newPage}))
    }
    const {traces, traceCount} = data || {}

    const annotationLinks = useMemo(
        () => (traces || []).map((t) => t.invocationIds || {}).filter(Boolean),
        [traces],
    )

    const {data: annotations, mutate: fetchAnnotations} = useAnnotations({
        queries: annotationLinks.length ? {annotation: {links: annotationLinks}} : undefined,
        waitUntil: annotationLinks.length === 0,
    })

    const tracesWithAnnotations: TracesWithAnnotations[] = useMemo(() => {
        return attachAnnotationsToTraces(traces || [], annotations || [])
    }, [traces, annotations])

    const clearQueryStates = () => {
        setSearchQuery("")
        setTraceTabs("tree")
        setFilters([])
        setSort({} as SortResult)
        setPagination({page: 1, size: 10})
    }

    observabilityContextValues.traces = tracesWithAnnotations
    observabilityContextValues.annotations = annotations
    observabilityContextValues.isLoading = isLoading
    observabilityContextValues.fetchTraces = fetchTraces
    observabilityContextValues.fetchAnnotations = fetchAnnotations
    observabilityContextValues.count = traceCount
    observabilityContextValues.navigateToPage = navigateToPage

    return (
        <ObservabilityContext.Provider
            value={{
                traces: tracesWithAnnotations,
                annotations,
                isLoading,
                fetchTraces,
                fetchAnnotations,
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
                navigateToPage,
            }}
        >
            {children}
        </ObservabilityContext.Provider>
    )
}

export default ObservabilityContextProvider
