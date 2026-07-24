// Query control atoms for the observability module
import type {Key} from "react"

import {defaultTraceTypeForWorkflow} from "@agenta/entities/workflow"
import dayjs from "dayjs"
import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import type {SortResult} from "@/oss/components/Filters/Sort"
import type {TestsetTraceData} from "@/oss/components/SharedDrawers/AddToTestsetDrawer/assets/types"
import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"
import type {Filter} from "@/oss/lib/Types"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

import {routerAppIdAtom} from "../../app"
import {SESSIONS_PAGE_SIZE, TRACES_PAGE_SIZE} from "../constants"

export type TraceTabTypes = "trace" | "span" | "chat"
export type ObservabilityTabInfo = "traces" | "sessions"

export const DEFAULT_SORT: SortResult = {
    type: "standard",
    sorted: dayjs().utc().subtract(24, "hours").toISOString().split(".")[0],
}

const HAS_RECEIVED_TRACES_STORAGE_KEY = "agenta:observability:has-received-traces"
const HAS_RECEIVED_SESSIONS_STORAGE_KEY = "agenta:observability:has-received-sessions"

const createHasReceivedTracesStorageKey = (userId: string) =>
    `${HAS_RECEIVED_TRACES_STORAGE_KEY}:${userId}`
const createHasReceivedSessionsStorageKey = (userId: string) =>
    `${HAS_RECEIVED_SESSIONS_STORAGE_KEY}:${userId}`

const hasReceivedTracesAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(createHasReceivedTracesStorageKey(userId), false),
)
const hasReceivedSessionsAtomFamily = atomFamily((userId: string) =>
    atomWithStorage<boolean>(createHasReceivedSessionsStorageKey(userId), false),
)

export const hasReceivedTracesAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(hasReceivedTracesAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(hasReceivedTracesAtomFamily(userId), next)
    },
)

export const hasReceivedSessionsAtom = atom(
    (get) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return false
        return get(hasReceivedSessionsAtomFamily(userId))
    },
    (get, set, next: boolean) => {
        const userId = get(onboardingStorageUserIdAtom)
        if (!userId) return
        set(hasReceivedSessionsAtomFamily(userId), next)
    },
)

// Global active tab state
export const observabilityTabAtom = atom<ObservabilityTabInfo>("traces")

// UI-level query controls families ------------------------------------------------
export const searchQueryAtomFamily = atomFamily((_tab: ObservabilityTabInfo) => atom<string>(""))
export const traceTabsAtomFamily = atomFamily((_tab: ObservabilityTabInfo) =>
    atom<TraceTabTypes>("trace"),
)
export const limitAtomFamily = atomFamily((tab: ObservabilityTabInfo) =>
    atom<number>(tab === "sessions" ? SESSIONS_PAGE_SIZE : TRACES_PAGE_SIZE),
)
export const sortAtomFamily = atomFamily((_tab: ObservabilityTabInfo) =>
    atom<SortResult>(DEFAULT_SORT as SortResult),
)
/**
 * User's intent for the `trace_type` filter. Tagged union — explicit
 * semantics instead of the dual-atom (default-enabled + filters-array) dance
 * that preceded it, where state could revert silently on re-derivations.
 *
 *   - `"default"`  — user has never touched trace_type → fall back to
 *                    `defaultTraceTypeForWorkflow(workflowKind, tab)`.
 *   - `"value"`    — user picked a specific value (annotation or invocation).
 *   - `"cleared"`  — user explicitly removed the trace_type filter.
 *
 * The effective trace_type is derived in `effectiveTraceTypeAtomFamily`;
 * downstream atoms (scope filter, query body) read that derived value.
 */
export type TraceTypeChoice =
    | {kind: "default"}
    | {kind: "value"; value: "annotation" | "invocation"}
    | {kind: "cleared"}

// --- Persisted filter state (per app, per tab) -------------------------------
//
// Filter selections are persisted across reloads so users don't have to
// re-apply the same filter every time they open a page. State is scoped by
// `app_id` so two apps can carry different filter setups, and by tab
// (`traces` vs `sessions`) because those have independent UIs.
//
// Storage shape:
//   {
//     "<appId>": {
//       "traces":   { userFilters: Filter[], traceTypeChoice: TraceTypeChoice },
//       "sessions": { userFilters: Filter[], traceTypeChoice: TraceTypeChoice },
//     },
//     "__global__": { ... }  // when there's no router app_id (project scope)
//   }
//
// We pack both pieces into one storage atom (instead of two parallel ones)
// so a single write doesn't race the other against localStorage, and so the
// scoped record can be cleaned up atomically per app if we ever need it.

interface PersistedFilterTabState {
    userFilters: Filter[]
    traceTypeChoice: TraceTypeChoice
}

type PersistedFilterAppState = Partial<Record<ObservabilityTabInfo, PersistedFilterTabState>>

const FILTERS_STORAGE_KEY = "agenta:observability:filters"
const GLOBAL_SCOPE_KEY = "__global__"

const filtersByAppAtom = atomWithStorage<Record<string, PersistedFilterAppState>>(
    FILTERS_STORAGE_KEY,
    {},
)

const emptyTabState: PersistedFilterTabState = {
    userFilters: [],
    traceTypeChoice: {kind: "default"},
}

const readTabState = (
    all: Record<string, PersistedFilterAppState>,
    appKey: string,
    tab: ObservabilityTabInfo,
): PersistedFilterTabState => all[appKey]?.[tab] ?? emptyTabState

const writeTabState = (
    all: Record<string, PersistedFilterAppState>,
    appKey: string,
    tab: ObservabilityTabInfo,
    next: PersistedFilterTabState,
): Record<string, PersistedFilterAppState> => ({
    ...all,
    [appKey]: {
        ...(all[appKey] ?? {}),
        [tab]: next,
    },
})

export const traceTypeChoiceAtomFamily = atomFamily((tab: ObservabilityTabInfo) =>
    atom(
        (get): TraceTypeChoice => {
            const appKey = get(routerAppIdAtom) || GLOBAL_SCOPE_KEY
            return readTabState(get(filtersByAppAtom), appKey, tab).traceTypeChoice
        },
        (get, set, next: TraceTypeChoice) => {
            const appKey = get(routerAppIdAtom) || GLOBAL_SCOPE_KEY
            const all = get(filtersByAppAtom)
            const current = readTabState(all, appKey, tab)
            set(
                filtersByAppAtom,
                writeTabState(all, appKey, tab, {...current, traceTypeChoice: next}),
            )
        },
    ),
)

/**
 * Effective trace_type — read this anywhere downstream that needs to know
 * "what trace_type filter is currently in effect". `null` means no
 * trace_type filter (user cleared, or no default applies for this tab).
 */
export const effectiveTraceTypeAtomFamily = atomFamily((tab: ObservabilityTabInfo) =>
    atom<"annotation" | "invocation" | null>((get) => {
        const choice = get(traceTypeChoiceAtomFamily(tab))
        if (choice.kind === "cleared") return null
        if (choice.kind === "value") return choice.value
        // default — look up the per-workflow-kind default
        const workflowCtx = get(currentWorkflowContextAtom)
        const def = defaultTraceTypeForWorkflow(workflowCtx.workflowKind, tab)
        if (def === "annotation" || def === "invocation") return def
        return null
    }),
)

// User-defined filters (excluding `trace_type`, which has its own atom).
// Persisted per-app (see `filtersByAppAtom` above).
export const userFiltersAtomFamily = atomFamily((tab: ObservabilityTabInfo) =>
    atom(
        (get): Filter[] => {
            const appKey = get(routerAppIdAtom) || GLOBAL_SCOPE_KEY
            return readTabState(get(filtersByAppAtom), appKey, tab).userFilters
        },
        (get, set, next: Filter[]) => {
            const appKey = get(routerAppIdAtom) || GLOBAL_SCOPE_KEY
            const all = get(filtersByAppAtom)
            const current = readTabState(all, appKey, tab)
            set(filtersByAppAtom, writeTabState(all, appKey, tab, {...current, userFilters: next}))
        },
    ),
)

const isTraceType = (f: Filter) => (f.key ?? f.field) === "trace_type"

// Proxy Atoms (for compatibility with existing UI) -----------------------------
export const searchQueryAtom = atom(
    (get) => get(searchQueryAtomFamily(get(observabilityTabAtom))),
    (get, set, value: string) => set(searchQueryAtomFamily(get(observabilityTabAtom)), value),
)

export const traceTabsAtom = atom(
    (get) => get(traceTabsAtomFamily(get(observabilityTabAtom))),
    (get, set, value: TraceTabTypes | ((prev: TraceTabTypes) => TraceTabTypes)) =>
        set(traceTabsAtomFamily(get(observabilityTabAtom)), value),
)

export const limitAtom = atom(
    (get) => get(limitAtomFamily(get(observabilityTabAtom))),
    (get, set, value: number) => set(limitAtomFamily(get(observabilityTabAtom)), value),
)

export const sortAtom = atom(
    (get) => get(sortAtomFamily(get(observabilityTabAtom))),
    (get, set, value: SortResult) => set(sortAtomFamily(get(observabilityTabAtom)), value),
)

/**
 * Combined filter view — what consumers (query layer, dialog) see.
 *
 * Composed from three pieces, in order:
 *
 *   1. **Scope filter** (`isPermanent: true`) — pins traces to the current
 *      entity. Shape depends on workflow kind and the effective trace_type:
 *
 *      - App workflows always pin to `references.application.id = <appId>`.
 *      - Evaluator workflows route to different reference slots because the
 *        two relevant trace shapes write the evaluator's id into different
 *        slots:
 *          * Annotation traces (real evaluation runs scoring an app) put the
 *            evaluator id in `references.evaluator.id`.
 *          * Invocation traces (evaluator run standalone as an app) put it
 *            in `references.application.id`, same as a normal app trace.
 *        With trace_type known, we target the matching slot; with no
 *        trace_type, we OR-match both slots.
 *
 *   2. **trace_type filter** — derived from `effectiveTraceTypeAtomFamily`.
 *      Renders as a regular filter row in the dialog so the user can change
 *      or remove it. The atom is the single source of truth — there's no
 *      separate "is the default still active?" toggle. User edits flow back
 *      through the setter into `traceTypeChoiceAtomFamily`.
 *
 *   3. **Other user filters** — everything else the user has added via the
 *      filter dialog (search, span_type, has_annotation, …). Stored verbatim
 *      in `userFiltersAtomFamily`.
 *
 * The setter receives the merged array (from the dialog's Apply) and splits
 * it back: trace_type → `traceTypeChoiceAtomFamily`, other → `userFilters`.
 * The scope filter is always re-derived; the dialog can't write to it.
 */
export const filtersAtomFamily = atomFamily((tab: ObservabilityTabInfo) =>
    atom(
        (get) => {
            const appId = get(routerAppIdAtom)
            const userFilters = get(userFiltersAtomFamily(tab))
            const workflowCtx = get(currentWorkflowContextAtom)
            const effectiveTraceType = get(effectiveTraceTypeAtomFamily(tab))

            // Build the trace_type filter row (if any)
            const traceTypeFilters: Filter[] = effectiveTraceType
                ? [{field: "trace_type", operator: "is", value: effectiveTraceType}]
                : []

            // Build the scope filter row
            const isEvaluatorWorkflow = workflowCtx.workflowKind === "evaluator"
            const buildEvalScopeValue = () => {
                const id = String(appId)
                if (effectiveTraceType === "annotation") {
                    return [{id, "attributes.key": "evaluator"}]
                }
                if (effectiveTraceType === "invocation") {
                    return [{id, "attributes.key": "application"}]
                }
                // No trace_type filter — OR both ref slots so every trace
                // mentioning this evaluator in either slot shows.
                return [
                    {id, "attributes.key": "evaluator"},
                    {id, "attributes.key": "application"},
                ]
            }
            const appScopeValue = appId
                ? isEvaluatorWorkflow
                    ? buildEvalScopeValue()
                    : [{id: String(appId), "attributes.key": "application"}]
                : []
            const appScope: Filter[] =
                appScopeValue.length > 0
                    ? [
                          {
                              field: "references",
                              operator: "in",
                              value: appScopeValue,
                              isPermanent: true,
                          },
                      ]
                    : []

            return [...appScope, ...traceTypeFilters, ...userFilters]
        },
        (get, set, update: Filter[] | ((prev: Filter[]) => Filter[])) => {
            const currentCombined = get(filtersAtomFamily(tab))
            const nextCombined =
                typeof update === "function" ? (update as any)(currentCombined) : update
            const normalizedNext = nextCombined || []

            // Strip the permanent scope filter — it's regenerated, not stored.
            const nextNonPermanent = normalizedNext.filter((f: Filter) => !(f as any).isPermanent)

            // Split the incoming non-permanent filters: trace_type → choice
            // atom, everything else → userFilters atom.
            const nextTraceType = nextNonPermanent.find(isTraceType)
            const nextOthers = nextNonPermanent.filter((f: Filter) => !isTraceType(f))

            set(userFiltersAtomFamily(tab), nextOthers)

            // Trace-type intent routing:
            //   - User has trace_type in the incoming array → store as
            //     {kind: "value", value: …}.
            //   - User HAD trace_type before, doesn't now → they cleared it
            //     → store as {kind: "cleared"}.
            //   - Neither: don't touch (e.g., updating only `search` shouldn't
            //     overwrite the trace_type intent).
            if (nextTraceType) {
                // The filter dialog sends `value` as a scalar for `is`/
                // `is_not` and as an array for `in`/`not_in` (e.g.,
                // `["annotation"]`). Normalize to an array, filter to known
                // enum values, then collapse single-value arrays back to a
                // scalar for the choice atom — which only stores one value.
                const rawValues = Array.isArray(nextTraceType.value)
                    ? nextTraceType.value
                    : [nextTraceType.value]
                const values = rawValues.filter(
                    (entry: unknown): entry is "annotation" | "invocation" =>
                        entry === "annotation" || entry === "invocation",
                )
                const op = nextTraceType.operator
                const isAffirm = op === "is" || op === "in"
                const isNeg = op === "is_not" || op === "not_in"
                const flip = (x: "annotation" | "invocation"): "annotation" | "invocation" =>
                    x === "annotation" ? "invocation" : "annotation"
                let resolved: "annotation" | "invocation" | null = null
                if (values.length === 1) {
                    if (isAffirm) resolved = values[0]
                    else if (isNeg) resolved = flip(values[0])
                }
                if (resolved) {
                    set(traceTypeChoiceAtomFamily(tab), {kind: "value", value: resolved})
                } else {
                    // Multi-value selections (e.g., `in: ["annotation",
                    // "invocation"]` — equivalent to "no filter") or
                    // future enum values we don't map. Treat as cleared
                    // rather than fabricating a single-value pick.
                    set(traceTypeChoiceAtomFamily(tab), {kind: "cleared"})
                }
            } else {
                const hadTraceType = currentCombined.some(isTraceType)
                if (hadTraceType) {
                    set(traceTypeChoiceAtomFamily(tab), {kind: "cleared"})
                }
                // else: don't touch — caller didn't intend to change trace_type
            }
        },
    ),
)

// Proxy filters atom
export const filtersAtom = atom(
    (get) => get(filtersAtomFamily(get(observabilityTabAtom))),
    (get, set, update: Filter[] | ((prev: Filter[]) => Filter[])) =>
        set(filtersAtomFamily(get(observabilityTabAtom)), update),
)

// Table/UI controls -----------------------------------------------------------
export const selectedTraceIdAtom = atom<string>("")
export const selectedNodeAtom = atom<string>("")
export const selectedRowKeysAtom = atom<Key[]>([])
export const testsetDrawerDataAtom = atom<TestsetTraceData[]>([])
export const isAnnotationsSectionOpenAtom = atom<boolean>(true)

// Activity mode control: false = "all activity" (stable, first_active), true = "latest activity" (unstable, last_active)
export const realtimeModeAtomFamily = atomFamily((_tab: ObservabilityTabInfo) =>
    atom<boolean>(false),
)
export const realtimeModeAtom = atom(
    (get) => get(realtimeModeAtomFamily(get(observabilityTabAtom))),
    (get, set, value: boolean) => set(realtimeModeAtomFamily(get(observabilityTabAtom)), value),
)

// Auto-refresh control: when true, refreshes every 15 seconds
// Shared across all tabs (traces and sessions)
export const autoRefreshAtom = atom<boolean>(false)
