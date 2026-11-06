import {useCallback} from "react"

import type {EvaluationRunKind} from "@agenta/entities/evaluationRun"
import {ANALYTICS_RANGE_PRESETS, type AnalyticsRangeLabel} from "@agenta/observability"

import {useUrlParams} from "../../developer/useUrlParams"

export type EvaluationKindTab = "all" | EvaluationRunKind

export const KIND_TABS: readonly EvaluationKindTab[] = ["all", "auto", "human", "online", "custom"]

export const RUN_STATUS_OPTIONS = [
    {value: "pending", label: "Pending"},
    {value: "queued", label: "Queued"},
    {value: "running", label: "Running"},
    {value: "success", label: "Success"},
    {value: "failure", label: "Failure"},
    {value: "errors", label: "Errors"},
    {value: "cancelled", label: "Cancelled"},
] as const

/** The kinds the Type filter offers, as the old app's. */
export const RUN_TYPE_OPTIONS: readonly {value: EvaluationRunKind; label: string}[] = [
    {value: "auto", label: "Auto"},
    {value: "human", label: "Human"},
    {value: "online", label: "Live"},
    {value: "custom", label: "SDK"},
]

/** The quick date ranges, the old app's presets without "all time" (no range is all time). */
export const RUN_DATE_RANGES: readonly AnalyticsRangeLabel[] = ANALYTICS_RANGE_PRESETS.map(
    (preset) => preset.label,
).filter((label) => label !== "all time")

/** The reference filters, each a comma list of ids in the URL. */
export const REFERENCE_FILTERS = ["evaluator", "testset", "query", "variant"] as const
export type ReferenceFilterKey = (typeof REFERENCE_FILTERS)[number]

/** Everything the filter panel sets. Search, the kind tab and the app live outside it. */
export interface RunFilterValues {
    statuses: string[]
    types: EvaluationRunKind[]
    references: Record<ReferenceFilterKey, string[]>
    /** A quick range label, for example "7 days"; null is all time. */
    range: AnalyticsRangeLabel | null
}

export const EMPTY_RUN_FILTERS: RunFilterValues = {
    statuses: [],
    types: [],
    references: {evaluator: [], testset: [], query: [], variant: []},
    range: null,
}

const idList = (raw: string | null): string[] =>
    [...new Set((raw ?? "").split(","))].map((value) => value.trim()).filter(Boolean)

/** The known kinds of a comma list, in the menu's order. */
export const parseTypes = (raw: string | null): EvaluationRunKind[] => {
    const wanted = new Set(idList(raw))
    return RUN_TYPE_OPTIONS.map((option) => option.value).filter((value) => wanted.has(value))
}

export const parseRange = (raw: string | null): AnalyticsRangeLabel | null =>
    RUN_DATE_RANGES.find((label) => label === raw) ?? null

/** How many filters of the panel are set: one per field with a value. */
export const countRunFilters = (values: RunFilterValues): number =>
    [
        values.statuses.length > 0,
        values.types.length > 0,
        ...REFERENCE_FILTERS.map((key) => values.references[key].length > 0),
        values.range !== null,
    ].filter(Boolean).length

/** An unknown value reads as `all`. A live run belongs to no single app, so app scope drops it. */
export const parseKindTab = (raw: string | null, appScoped: boolean): EvaluationKindTab => {
    const kind = KIND_TABS.find((tab) => tab === raw) ?? "all"
    return appScoped && kind === "online" ? "all" : kind
}

/** The known statuses of a comma list, in the menu's order. */
export const parseStatuses = (raw: string | null): string[] => {
    const wanted = new Set((raw ?? "").split(",").map((value) => value.trim()))
    return RUN_STATUS_OPTIONS.map((option) => option.value).filter((value) => wanted.has(value))
}

/** The runs list's filters, kept in the URL so a link or a reload shows the same list. */
export const useEvaluationRunsFilters = () => {
    const {read, write} = useUrlParams()
    const appId = read("app")
    const search = read("q") ?? ""
    const statuses = parseStatuses(read("status"))
    const kind = parseKindTab(read("kind"), appId !== null)
    const panel: RunFilterValues = {
        statuses,
        types: parseTypes(read("types")),
        references: {
            evaluator: idList(read("evaluator")),
            testset: idList(read("testset")),
            query: idList(read("query")),
            // A variant belongs to the picked app: without one it filters nothing.
            variant: appId ? idList(read("variant")) : [],
        },
        range: parseRange(read("range")),
    }

    const setKind = useCallback(
        (next: EvaluationKindTab) => write({kind: next === "all" ? null : next}),
        [write],
    )
    // A new app drops the variants of the old one.
    const setAppId = useCallback(
        (next: string | null) => write({app: next, variant: null}),
        [write],
    )
    const setSearch = useCallback((next: string) => write({q: next.trim() ? next : null}), [write])
    const setPanel = useCallback(
        (next: RunFilterValues) =>
            write({
                status: next.statuses.length > 0 ? next.statuses.join(",") : null,
                types: next.types.length > 0 ? next.types.join(",") : null,
                ...Object.fromEntries(
                    REFERENCE_FILTERS.map((key) => [
                        key,
                        next.references[key].length > 0 ? next.references[key].join(",") : null,
                    ]),
                ),
                range: next.range,
            }),
        [write],
    )
    const clearFilters = useCallback(
        () =>
            write({
                q: null,
                status: null,
                types: null,
                evaluator: null,
                testset: null,
                query: null,
                variant: null,
                range: null,
            }),
        [write],
    )

    return {
        kind,
        appId,
        search,
        statuses,
        panel,
        setPanel,
        setKind,
        setAppId,
        setSearch,
        clearFilters,
    }
}
