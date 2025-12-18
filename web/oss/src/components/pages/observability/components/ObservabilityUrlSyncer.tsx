import {useEffect} from "react"

import {useAtom} from "jotai"

import {useQueryParamState} from "@/oss/state/appState"
import {
    DEFAULT_SORT,
    filtersAtom,
    limitAtom,
    searchQueryAtom,
    sortAtom,
    traceTabsAtom,
    TraceTabTypes,
} from "@/oss/state/newObservability"

const ObservabilityUrlSyncer = () => {
    // 1. View (Trace Tabs)
    const [viewParam, setViewParam] = useQueryParamState("view")
    const [viewAtom, setViewAtom] = useAtom(traceTabsAtom)

    useEffect(() => {
        if (viewParam && viewParam !== viewAtom) {
            if (["trace", "span", "chat"].includes(viewParam as string)) {
                setViewAtom(viewParam as TraceTabTypes)
            }
        }
    }, [viewParam, setViewAtom, viewAtom])

    useEffect(() => {
        if (viewAtom && viewAtom !== viewParam) {
            setViewParam(viewAtom)
        }
    }, [viewAtom, setViewParam, viewParam])

    // 2. Search
    const [searchParam, setSearchParam] = useQueryParamState("search")
    const [searchAtom, setSearchAtom] = useAtom(searchQueryAtom)

    useEffect(() => {
        if (typeof searchParam === "string" && searchParam !== searchAtom) {
            setSearchAtom(searchParam)
        }
    }, [searchParam, setSearchAtom, searchAtom])

    useEffect(() => {
        if (searchAtom !== searchParam) {
            setSearchParam(searchAtom || undefined)
        }
    }, [searchAtom, setSearchParam, searchParam])

    // 3. Limit
    const [limitParam, setLimitParam] = useQueryParamState("limit")
    const [limitAtomValue, setLimitAtom] = useAtom(limitAtom)

    useEffect(() => {
        if (limitParam) {
            const parsed = parseInt(limitParam as string, 10)
            if (!isNaN(parsed) && parsed !== limitAtomValue) {
                setLimitAtom(parsed)
            }
        }
    }, [limitParam, setLimitAtom, limitAtomValue])

    useEffect(() => {
        if (limitAtomValue !== 50 && String(limitAtomValue) !== limitParam) {
            setLimitParam(String(limitAtomValue))
        } else if (limitAtomValue === 50 && limitParam) {
            setLimitParam(undefined)
        }
    }, [limitAtomValue, setLimitParam, limitParam])

    // 4. Sort
    const [sortParam, setSortParam] = useQueryParamState("sort")
    const [sortAtomValue, setSortAtom] = useAtom(sortAtom)

    useEffect(() => {
        if (sortParam) {
            try {
                const parsed = JSON.parse(sortParam as string)
                if (JSON.stringify(parsed) !== JSON.stringify(sortAtomValue)) {
                    setSortAtom(parsed)
                }
            } catch (e) {
                // ignore invalid json
            }
        }
    }, [sortParam, setSortAtom, sortAtomValue])

    useEffect(() => {
        if (JSON.stringify(sortAtomValue) !== JSON.stringify(DEFAULT_SORT)) {
            const str = JSON.stringify(sortAtomValue)
            if (str !== sortParam) {
                setSortParam(str)
            }
        } else if (sortParam) {
            setSortParam(undefined)
        }
    }, [sortAtomValue, setSortParam, sortParam])

    // 5. Filters
    const [filtersParam, setFiltersParam] = useQueryParamState("filters")
    const [filtersAtomValue, setFiltersAtom] = useAtom(filtersAtom)

    useEffect(() => {
        if (filtersParam) {
            try {
                const parsed = JSON.parse(filtersParam as string)
                // Simplistic equality check usually enough for this sync direction
                // We rely on stable serialization
                const currentNonPermanent = filtersAtomValue.filter((f) => !f.isPermanent)
                if (JSON.stringify(parsed) !== JSON.stringify(currentNonPermanent)) {
                    // We need to be careful not to overwrite if they are semantically filtered
                    setFiltersAtom(parsed)
                }
            } catch (e) {
                // ignore
            }
        }
    }, [filtersParam, setFiltersAtom]) // Intentional missing dependency for filtersAtomValue to avoid loop? No, logic needs to be robust.

    useEffect(() => {
        const nonPermanent = filtersAtomValue.filter((f) => !f.isPermanent)
        if (nonPermanent.length > 0) {
            const str = JSON.stringify(nonPermanent)
            if (str !== filtersParam) {
                setFiltersParam(str)
            }
        } else if (filtersParam) {
            setFiltersParam(undefined)
        }
    }, [filtersAtomValue, setFiltersParam, filtersParam])

    return null
}

export default ObservabilityUrlSyncer
