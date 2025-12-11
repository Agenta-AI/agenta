import {atom} from "jotai"

import type {Filter} from "@/oss/lib/Types"
import {routerAppIdAtom} from "@/oss/state/app"

const userFiltersAtom = atom<Filter[]>([])

/** Permanent filter that limits live evaluations to invocation traces only */
const INVOCATION_FILTER: Filter = {
    field: "trace_type",
    operator: "is",
    value: "invocation",
    isPermanent: true,
}

export const onlineEvalFiltersAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom)
        const userFilters = get(userFiltersAtom)

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

        return [...appScope, INVOCATION_FILTER, ...userFilters]
    },
    (get, set, update: Filter[] | ((prev: Filter[]) => Filter[])) => {
        const currentCombined = get(onlineEvalFiltersAtom)
        const nextCombined =
            typeof update === "function" ? (update as any)(currentCombined) : update
        const normalizedNext = Array.isArray(nextCombined) ? nextCombined.filter(Boolean) : []

        const nextUserFilters = normalizedNext.filter((filter) => !(filter as any).isPermanent)
        set(userFiltersAtom, nextUserFilters)
    },
)

export const resetOnlineEvalFiltersAtom = atom(null, (get, set) => {
    set(userFiltersAtom, [])
})
