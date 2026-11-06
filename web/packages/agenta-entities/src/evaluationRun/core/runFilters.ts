/**
 * Evaluation runs list filters, copied from the old app as pure functions: the flags per tab
 * (`EvaluationRunsTablePOC/atoms/context.ts`), the reference filters
 * (`EvaluationRunsTablePOC/utils/referencePayload.ts`), the `POST /evaluations/runs/query` body
 * (`usePreviewEvaluations/assets/previewRunsRequest.ts`) and the active filter count
 * (`EvaluationRunsTablePOC/atoms/view.ts`).
 *
 * @packageDocumentation
 */

import type {EvaluationRunKind} from "./runKind"

/** The run flags the runs query can filter on. */
export interface RunFlagsFilter {
    is_live?: boolean
    is_active?: boolean
    is_closed?: boolean
    is_queue?: boolean
    has_queries?: boolean
    has_testsets?: boolean
    has_testcases?: boolean
    has_traces?: boolean
    has_evaluators?: boolean
    has_custom?: boolean
    has_human?: boolean
    has_auto?: boolean
}

/** A list tab: one run kind, or every kind. */
export type RunListTab = EvaluationRunKind | "all"

/**
 * Leaves out runs fed straight by an annotation queue (test cases or traces added by hand). Those
 * runs belong to Annotation queues, not to the evaluations list.
 */
const NOT_DIRECT_QUEUE: RunFlagsFilter = {has_testcases: false, has_traces: false}

/** The flags each tab sends, as the old app sends them. */
export function runListTabFlags(tab: RunListTab): RunFlagsFilter {
    switch (tab) {
        case "online":
            return {is_live: true}
        case "auto":
            return {has_auto: true, ...NOT_DIRECT_QUEUE}
        case "human":
            return {has_human: true, ...NOT_DIRECT_QUEUE}
        case "custom":
            return {has_custom: true, ...NOT_DIRECT_QUEUE}
        default:
            return {...NOT_DIRECT_QUEUE}
    }
}

export type RunReferenceFilterKey = "testset" | "evaluator" | "app" | "variant" | "query"
export type RunReferenceFilters = Partial<Record<RunReferenceFilterKey, readonly string[]>>
export type RunReferencePayload = Record<string, {id?: string; slug?: string}>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_ID = /^[0-9a-f]{24}$/i

const idOrSlug = (value: string, isId: boolean) => (isId ? {id: value} : {slug: value})

/**
 * The `run.references` filter: one entry per picked value. An evaluator, query or test set is sent
 * by id when the value is an id, else by slug; an app and a variant always by id.
 */
export function buildRunReferencePayload(
    filters: RunReferenceFilters | null | undefined,
): RunReferencePayload[] | undefined {
    if (!filters) return undefined
    const entries = Object.entries(filters).flatMap(([key, values]) =>
        (values ?? []).flatMap((raw): RunReferencePayload[] => {
            const value = raw?.trim()
            if (!value) return []
            switch (key) {
                case "evaluator":
                case "query":
                    return [{[key]: idOrSlug(value, UUID.test(value))}]
                case "testset":
                    return [{testset: idOrSlug(value, UUID.test(value) || HEX_ID.test(value))}]
                case "app":
                    return [{application: {id: value}}]
                case "variant":
                    return [{application_variant: {id: value}}]
                default:
                    return [{[key]: {slug: value}}]
            }
        }),
    )
    return entries.length ? entries : undefined
}

export interface RunsQueryWindowing {
    next?: string | null
    limit?: number | null
    order?: "ascending" | "descending" | null
    newest?: string | null
    oldest?: string | null
}

export interface RunsQueryInput {
    search?: string | null
    references?: readonly RunReferencePayload[] | null
    flags?: RunFlagsFilter | null
    statuses?: readonly string[] | null
    evaluationKinds?: readonly string[] | null
    windowing?: RunsQueryWindowing | null
}

export interface RunsQueryBody {
    run?: {
        references?: RunReferencePayload[]
        search?: string
        flags?: RunFlagsFilter
        statuses?: string[]
        evaluation_kinds?: string[]
    }
    windowing?: {
        next?: string
        limit?: number
        order?: "ascending" | "descending"
        newest?: string
        oldest?: string
    }
}

const sortedUnique = (values: readonly string[] | null | undefined, lower = false) => {
    const list = [
        ...new Set((values ?? []).filter(Boolean).map((v) => (lower ? v.toLowerCase() : v))),
    ]
    return list.length ? list.sort() : null
}

const definedOnly = <T extends object>(value: T): T =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as T

/**
 * The `POST /evaluations/runs/query` body. Empty parts are left out; flags, statuses and kinds are
 * sorted so equal filters give equal bodies (and equal query keys).
 */
export function buildRunsQueryBody(input: RunsQueryInput): RunsQueryBody {
    const run: NonNullable<RunsQueryBody["run"]> = {}
    const references = (input.references ?? []).filter((entry) => Object.keys(entry).length > 0)
    if (references.length) run.references = references
    if (input.search) run.search = input.search
    const flagEntries = Object.entries(input.flags ?? {})
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
    if (flagEntries.length) run.flags = Object.fromEntries(flagEntries)
    const statuses = sortedUnique(input.statuses)
    if (statuses) run.statuses = statuses
    const kinds = sortedUnique(input.evaluationKinds, true)
    if (kinds) run.evaluation_kinds = kinds

    const body: RunsQueryBody = {}
    if (Object.keys(run).length) body.run = run
    if (input.windowing) {
        const {next, limit, order, newest, oldest} = input.windowing
        body.windowing = definedOnly({
            next: next ?? undefined,
            limit: limit ?? undefined,
            order: order ?? undefined,
            newest: newest ?? undefined,
            oldest: oldest ?? undefined,
        })
    }
    return body
}

export interface RunListFilterState {
    statuses?: readonly string[] | null
    references?: RunReferenceFilters | null
    /** Kinds picked in the filter; on a kind tab the tab's kind counts when none is picked. */
    evaluationKinds?: readonly EvaluationRunKind[] | null
    dateRange?: {from?: string | null; to?: string | null} | null
}

/** The number on the filter button: statuses, reference values, kinds, and 1 for a date range. */
export function countRunListFilters(state: RunListFilterState, tab: RunListTab): number {
    const references = Object.values(state.references ?? {}).reduce(
        (sum, values) => sum + (values?.length ?? 0),
        0,
    )
    const kinds = state.evaluationKinds?.length
        ? state.evaluationKinds.length
        : tab !== "all"
          ? 1
          : 0
    const date = state.dateRange?.from || state.dateRange?.to ? 1 : 0
    return (state.statuses?.length ?? 0) + references + kinds + date
}
