// Query control atoms for the observability module
import type {Key} from "react"

import dayjs from "dayjs"
import {atom} from "jotai"
import {eagerAtom} from "jotai-eager"

import type {SortResult} from "@/oss/components/Filters/Sort"
import type {TestsetTraceData} from "@/oss/components/pages/observability/drawer/TestsetDrawer/assets/types"
import type {Filter} from "@/oss/lib/Types"

import {routerAppIdAtom} from "../../app"

export type TraceTabTypes = "tree" | "node" | "chat"
export interface PaginationState {
    page: number
    size: number
}

export const DEFAULT_SORT: SortResult = {
    type: "standard",
    sorted: dayjs().utc().subtract(24, "hours").toISOString().split(".")[0],
}

// UI-level query controls ----------------------------------------------------
export const searchQueryAtom = atom<string>("")
export const traceTabsAtom = atom<TraceTabTypes>("tree")

// Keep user-defined filters separately, and always merge the permanent app filter on read.
const userFiltersAtom = atom<Filter[]>([])

export const filtersAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom)
        const userFilters = get(userFiltersAtom)
        const permanent = appId
            ? [
                  {
                      key: "refs.application.id",
                      operator: "is",
                      value: appId,
                      isPermanent: true,
                  } as Filter,
              ]
            : []
        return [...permanent, ...userFilters]
    },
    (get, set, update: Filter[] | ((prev: Filter[]) => Filter[])) => {
        // Support functional updates that may be based on the combined list (permanent + user)
        const currentCombined = get(filtersAtom)
        const nextCombined =
            typeof update === "function" ? (update as any)(currentCombined) : update

        // Persist only non-permanent filters as user filters
        const nextUserFilters = (nextCombined || []).filter(
            (f) => !(f as any).isPermanent && f.key !== "refs.application.id",
        )

        set(userFiltersAtom, nextUserFilters)
    },
)
export const sortAtom = atom<SortResult>(DEFAULT_SORT as SortResult)
export const paginationAtom = atom<PaginationState>({page: 1, size: 50})

// Table/UI controls -----------------------------------------------------------
export const selectedTraceIdAtom = atom<string>("")
export const selectedNodeAtom = atom<string>("")
export const editColumnsAtom = atom<string[]>(["span_type", "key", "usage", "tag"])
export const selectedRowKeysAtom = atom<Key[]>([])
export const testsetDrawerDataAtom = atom<TestsetTraceData[]>([])
export const isAnnotationsSectionOpenAtom = atom<boolean>(true)

// Derived helpers ------------------------------------------------------------
export const pageIndexAtom = eagerAtom((get) => get(paginationAtom).page)
export const pageSizeAtom = eagerAtom((get) => get(paginationAtom).size)
