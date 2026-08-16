/** The preset names the range picker offers; `custom` pairs with an explicit start/end. */
export type AnalyticsRangeLabel =
    | "30 mins"
    | "1 hour"
    | "6 hours"
    | "24 hours"
    | "3 days"
    | "7 days"
    | "14 days"
    | "1 month"
    | "3 months"
    | "all time"
    | "custom"
    | ""

/** A resolved time window: `sorted` is the ISO start for standard presets. */
export interface AnalyticsRange {
    type: "custom" | "standard"
    sorted: string
    customRange?: {startTime?: string; endTime?: string}
    label?: AnalyticsRangeLabel
}

/**
 * The dashboard figures every usage surface reads — one bucket series plus the roll-ups.
 *
 * `/spans/analytics/query` carries no per-bucket environment/variant and does not split tokens
 * by prompt/completion, so those four stay optional and unpopulated.
 */
export interface DashboardData {
    data: {
        timestamp: number | string
        success_count: number
        failure_count: number
        cost: number
        latency: number
        total_tokens: number
        prompt_tokens?: number
        completion_tokens?: number
        enviornment?: string
        variant?: string
    }[]
    total_count: number
    failure_rate: number
    total_cost: number
    avg_cost: number
    avg_latency: number
    total_tokens: number
    avg_tokens: number
}

// ============================================================================
// OBSERVABILITY QUERY TYPES
// ============================================================================

/**
 * The sort/range picker's result. Structurally the analytics range — the two
 * surfaces pick the same windows, so they share one type rather than drifting.
 */
export type SortResult = AnalyticsRange
export type SortTypes = AnalyticsRangeLabel

// `object` rather than `Record<string, unknown>`: interfaces have no implicit
// index signature, so the stricter form rejects every named filter-value type.
export type FilterValue =
    | string
    | number
    | boolean
    | object
    | (string | number | boolean | object)[]

export type FilterConditions =
    | "contains"
    | "matches"
    | "like"
    | "startswith"
    | "endswith"
    | "exists"
    | "not_exists"
    | "eq"
    | "neq"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "between"
    | "btwn"
    | "is"
    | "is_not"
    | "in"
    | "not_in"
    | ""

export interface Filter {
    field: string
    key?: string
    operator: FilterConditions
    value: FilterValue
    isPermanent?: boolean
}

/** Which projection the trace query asks for. `chat` maps to `span` on the wire. */
export type TraceTabTypes = "trace" | "span" | "chat"

/** The two observability tabs; most control atoms are keyed by it. */
export type ObservabilityTabInfo = "traces" | "sessions"

/**
 * User's intent for the `trace_type` filter. Tagged union — explicit
 * semantics instead of the dual-atom (default-enabled + filters-array) dance
 * that preceded it, where state could revert silently on re-derivations.
 *
 *   - `"default"`  — user has never touched trace_type → fall back to
 *                    `defaultTraceTypeForWorkflow(workflowKind, tab)`.
 *   - `"value"`    — user picked a specific value (annotation or invocation).
 *   - `"cleared"`  — user explicitly removed the trace_type filter.
 */
export type TraceTypeChoice =
    | {kind: "default"}
    | {kind: "value"; value: "annotation" | "invocation"}
    | {kind: "cleared"}
