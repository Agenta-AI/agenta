import {atom} from "jotai"

import type {Filter} from "@/oss/lib/Types"
import {routerAppIdAtom} from "@/oss/state/app"

const userFiltersAtom = atom<Filter[]>([])
const traceTypeDefaultEnabledAtom = atom<boolean>(true)

const isTraceTypeFilter = (filter: Filter) => (filter.key ?? filter.field) === "trace_type"

export const onlineEvalFiltersAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom)
        const userFilters = get(userFiltersAtom)
        const defaultEnabled = get(traceTypeDefaultEnabledAtom)

        const hasUserTraceType = userFilters.some(isTraceTypeFilter)

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
        const currentCombined = get(onlineEvalFiltersAtom)
        const nextCombined =
            typeof update === "function" ? (update as any)(currentCombined) : update
        const normalizedNext = Array.isArray(nextCombined) ? nextCombined.filter(Boolean) : []

        const nextUserFilters = normalizedNext.filter((filter) => !(filter as any).isPermanent)
        set(userFiltersAtom, nextUserFilters)

        if (!normalizedNext.some((filter) => !(filter as any).isPermanent)) {
            set(traceTypeDefaultEnabledAtom, false)
            return
        }

        const hadTraceType = currentCombined.some(isTraceTypeFilter)
        const hasTraceTypeNext = normalizedNext.some(isTraceTypeFilter)

        if (hadTraceType && !hasTraceTypeNext) {
            set(traceTypeDefaultEnabledAtom, false)
        }
    },
)

export const resetOnlineEvalFiltersAtom = atom(null, (get, set) => {
    set(userFiltersAtom, [])
    set(traceTypeDefaultEnabledAtom, true)
})
