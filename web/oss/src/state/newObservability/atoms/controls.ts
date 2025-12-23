// Query control atoms for the observability module
import type {Key} from "react"

import dayjs from "dayjs"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {SortResult} from "@/oss/components/Filters/Sort"
import type {TestsetTraceData} from "@/oss/components/SharedDrawers/AddToTestsetDrawer/assets/types"
import type {Filter} from "@/oss/lib/Types"

import {routerAppIdAtom} from "../../app"

export type TraceTabTypes = "trace" | "span" | "chat"
export type ObservabilityTabInfo = "traces" | "sessions"

export const DEFAULT_SORT: SortResult = {
    type: "standard",
    sorted: dayjs().utc().subtract(24, "hours").toISOString().split(".")[0],
}

// Global active tab state
export const observabilityTabAtom = atom<ObservabilityTabInfo>("traces")

// UI-level query controls families ------------------------------------------------
export const searchQueryAtomFamily = atomFamily((_tab: ObservabilityTabInfo) => atom<string>(""))
export const traceTabsAtomFamily = atomFamily((_tab: ObservabilityTabInfo) =>
    atom<TraceTabTypes>("trace"),
)
export const limitAtomFamily = atomFamily((tab: ObservabilityTabInfo) =>
    atom<number>(tab === "sessions" ? 20 : 50),
)
export const sortAtomFamily = atomFamily((_tab: ObservabilityTabInfo) =>
    atom<SortResult>(DEFAULT_SORT as SortResult),
)
export const traceTypeDefaultEnabledAtomFamily = atomFamily((_tab: ObservabilityTabInfo) =>
    atom<boolean>(true),
)

// User-defined filters family
export const userFiltersAtomFamily = atomFamily((_tab: ObservabilityTabInfo) => atom<Filter[]>([]))

const isTraceType = (f: Filter) => (f.key ?? f.field) === "trace_type"

// Proxy Atoms (for compatibility with existing UI) -----------------------------
export const searchQueryAtom = atom(
    (get) => get(searchQueryAtomFamily(get(observabilityTabAtom))),
    (get, set, value: string) => set(searchQueryAtomFamily(get(observabilityTabAtom)), value),
)

export const traceTabsAtom = atom(
    (get) => get(traceTabsAtomFamily(get(observabilityTabAtom))),
    (get, set, value: TraceTabTypes) => set(traceTabsAtomFamily(get(observabilityTabAtom)), value),
)

export const limitAtom = atom(
    (get) => get(limitAtomFamily(get(observabilityTabAtom))),
    (get, set, value: number) => set(limitAtomFamily(get(observabilityTabAtom)), value),
)

export const sortAtom = atom(
    (get) => get(sortAtomFamily(get(observabilityTabAtom))),
    (get, set, value: SortResult) => set(sortAtomFamily(get(observabilityTabAtom)), value),
)

// Computed Filters logic (centralized but applied per tab)
export const filtersAtomFamily = atomFamily((tab: ObservabilityTabInfo) =>
    atom(
        (get) => {
            const appId = get(routerAppIdAtom)
            const userFilters = get(userFiltersAtomFamily(tab))
            const defaultEnabled = get(traceTypeDefaultEnabledAtomFamily(tab))

            // Only apply soft default for traces, maybe? or both?
            // "Trace filter should apply on session tab filter" - keeping logic consistent for now
            // But if we want different defaults per tab, we can branch here.
            // For now, assuming similar behavior is desired but independent state.

            const hasUserTraceType = userFilters.some(isTraceType)

            const softDefaults: Filter[] = []
            if (defaultEnabled && !hasUserTraceType && tab === "traces") {
                softDefaults.push({
                    field: "trace_type",
                    operator: "is",
                    value: "invocation",
                })
            }

            const appScope: Filter[] = appId
                ? [
                      {
                          field: "references",
                          operator: "in",
                          value: [
                              {
                                  id: String(appId),
                                  "attributes.key": "application",
                              },
                          ],
                          isPermanent: true,
                      },
                  ]
                : []

            return [...appScope, ...softDefaults, ...userFilters]
        },
        (get, set, update: Filter[] | ((prev: Filter[]) => Filter[])) => {
            const currentCombined = get(filtersAtomFamily(tab))
            const nextCombined =
                typeof update === "function" ? (update as any)(currentCombined) : update
            const normalizedNext = nextCombined || []

            // Persist only non-permanent filters
            const nextUser = normalizedNext.filter((f: Filter) => !(f as any).isPermanent)
            set(userFiltersAtomFamily(tab), nextUser)

            // If only permanent filters remain (or none at all), keep the soft default disabled
            if (!normalizedNext.some((f: Filter) => !(f as any).isPermanent)) {
                set(traceTypeDefaultEnabledAtomFamily(tab), false)
                return
            }

            // If trace_type was present and now is not, the user explicitly cleared it.
            const hadTraceType = currentCombined.some(isTraceType)
            const hasTraceTypeNext = normalizedNext.some(isTraceType)
            if (hadTraceType && !hasTraceTypeNext) {
                set(traceTypeDefaultEnabledAtomFamily(tab), false)
            }
        },
    ),
)

// Proxy filters atom
export const filtersAtom = atom(
    (get) => get(filtersAtomFamily(get(observabilityTabAtom))),
    (get, set, update: Filter[]) => set(filtersAtomFamily(get(observabilityTabAtom)), update),
)

// Table/UI controls -----------------------------------------------------------
export const selectedTraceIdAtom = atom<string>("")
export const selectedNodeAtom = atom<string>("")
export const editColumnsAtom = atom<string[]>(["span_type", "key", "usage", "tag"])
export const selectedRowKeysAtom = atom<Key[]>([])
export const testsetDrawerDataAtom = atom<TestsetTraceData[]>([])
export const isAnnotationsSectionOpenAtom = atom<boolean>(true)
