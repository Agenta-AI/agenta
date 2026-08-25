import {useCallback} from "react"

import {
    filtersAtom,
    searchQueryAtom,
    traceTabsAtom,
    type Filter,
    type FilterConditions,
} from "@agenta/observability"
import {useAtomValue, useSetAtom} from "jotai"

import {useLazyEffect} from "./useLazyEffect"

export interface FilterUpdate {
    field: string
    operator: FilterConditions
    value: string
}

/** Upsert-or-drop a single-valued filter row: an empty value removes the field entirely. */
export const useUpdateFilter = () => {
    const setFilters = useSetAtom(filtersAtom)

    return useCallback(
        ({field, operator, value}: FilterUpdate) => {
            setFilters((prevFilters: Filter[]) => {
                const otherFilters = prevFilters.filter((f) => f.field !== field)
                return value ? [...otherFilters, {field, operator, value}] : otherFilters
            })
        },
        [setFilters],
    )
}

/** Drops one field from the applied filters. */
export const useDropFilterField = () => {
    const setFilters = useSetAtom(filtersAtom)

    return useCallback(
        (field: string) => {
            setFilters((prevFilters: Filter[]) => prevFilters.filter((f) => f.field !== field))
        },
        [setFilters],
    )
}

/**
 * Keeps the search box and the Root/LLM/All control in step when something else rewrites the
 * filters (the filter dialog, a Clear, a restored persisted set). Lazy so the initial mount
 * doesn't stomp the atoms with derived values.
 */
export const useToolbarFilterSync = (): void => {
    const filters = useAtomValue(filtersAtom)
    const setSearchQuery = useSetAtom(searchQueryAtom)
    const setTraceTabs = useSetAtom(traceTabsAtom)

    useLazyEffect(() => {
        const dataFilter = filters.find((f) => f.field === "content")
        setSearchQuery(dataFilter && typeof dataFilter.value === "string" ? dataFilter.value : "")
    }, [filters])

    useLazyEffect(() => {
        const spanTypeFilter = filters.find((f) => f.field === "span_type")?.value
        setTraceTabs((prev) =>
            spanTypeFilter === "chat" ? "chat" : prev === "chat" ? "trace" : prev,
        )
    }, [filters])
}
