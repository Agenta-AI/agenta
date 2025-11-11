// Query control atoms for the observability module
import type {Key} from "react"

import dayjs from "dayjs"
import {atom} from "jotai"

import type {SortResult} from "@/oss/components/Filters/Sort"
import type {TestsetTraceData} from "@/oss/components/pages/observability/drawer/TestsetDrawer/assets/types"
import type {Filter} from "@/oss/lib/Types"

import {routerAppIdAtom} from "../../app"

export type TraceTabTypes = "trace" | "span" | "chat"

export const DEFAULT_SORT: SortResult = {
    type: "standard",
    sorted: dayjs().utc().subtract(24, "hours").toISOString().split(".")[0],
}

// UI-level query controls ----------------------------------------------------
export const searchQueryAtom = atom<string>("")
export const traceTabsAtom = atom<TraceTabTypes>("trace")
export const limitAtom = atom<number>(50)

// Keep user-defined filters separately, and always merge the permanent app filter on read.
const userFiltersAtom = atom<Filter[]>([])

// Tracks whether the soft default should be auto-inserted.
const traceTypeDefaultEnabledAtom = atom<boolean>(true)

const isTraceType = (f: Filter) => (f.key ?? f.field) === "trace_type"

export const filtersAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom)
        const userFilters = get(userFiltersAtom)
        const defaultEnabled = get(traceTypeDefaultEnabledAtom)

        const hasUserTraceType = userFilters.some(isTraceType)

        const softDefaults: Filter[] = []
        if (defaultEnabled && !hasUserTraceType) {
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
                      key: "application.id",
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
        const currentCombined = get(filtersAtom)
        const nextCombined =
            typeof update === "function" ? (update as any)(currentCombined) : update
        const normalizedNext = nextCombined || []

        // Persist only non-permanent filters
        const nextUser = normalizedNext.filter((f) => !(f as any).isPermanent)
        set(userFiltersAtom, nextUser)

        // If only permanent filters remain (or none at all), keep the soft default disabled
        if (!normalizedNext.some((f) => !(f as any).isPermanent)) {
            set(traceTypeDefaultEnabledAtom, false)
            return
        }

        // If trace_type was present and now is not, the user explicitly cleared it.
        const hadTraceType = currentCombined.some(isTraceType)
        const hasTraceTypeNext = normalizedNext.some(isTraceType)
        if (hadTraceType && !hasTraceTypeNext) {
            set(traceTypeDefaultEnabledAtom, false)
        }
    },
)
export const sortAtom = atom<SortResult>(DEFAULT_SORT as SortResult)

// Table/UI controls -----------------------------------------------------------
export const selectedTraceIdAtom = atom<string>("")
export const selectedNodeAtom = atom<string>("")
export const editColumnsAtom = atom<string[]>(["span_type", "key", "usage", "tag"])
export const selectedRowKeysAtom = atom<Key[]>([])
export const testsetDrawerDataAtom = atom<TestsetTraceData[]>([])
export const isAnnotationsSectionOpenAtom = atom<boolean>(true)
