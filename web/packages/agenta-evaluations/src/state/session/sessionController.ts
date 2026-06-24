/**
 * Generic evaluation **session engine** — scenario navigation / progress / focus / view over
 * an INJECTED scenario source.
 *
 * Extracted from `@agenta/annotation`'s annotationSessionController (the navigation logic is
 * moved verbatim) with two deliberate changes for genericity:
 *   1. The scenario LIST + its query state are injected by the consumer
 *      (`actions.setScenarios`) instead of being read from `simpleQueueMolecule`. Annotation
 *      injects its queue-scoped (user-filtered) source; the eval-run view injects a run-scoped
 *      source. The engine never imports a scenario molecule.
 *   2. The run/project context is supplied via `openSession({projectId, runId})` instead of
 *      being derived from `activeQueueId` — decoupled from any global store.
 *
 * Scenario-DATA selectors (steps/trace/metrics keyed by {projectId, runId, scenarioId}) are a
 * separate concern (thin wrappers over evaluationRun molecule) added alongside this engine.
 */
import {atom, type Atom, type Getter, type Setter} from "jotai"

import type {
    ApplyRouteStatePayload,
    OpenSessionPayload,
    SessionCallbacks,
    SessionContext,
    SessionProgress,
    SessionScenario,
    SessionScenariosQueryState,
    SessionView,
} from "./types"

// ============================================================================
// CONSUMER CALLBACKS
// ============================================================================

let _onOpened: SessionCallbacks["onOpened"]
let _onNavigate: SessionCallbacks["onNavigate"]
let _onSubmitted: SessionCallbacks["onSubmitted"]
let _onClosed: SessionCallbacks["onClosed"]

/** Register consumer side-effect hooks (route sync, submit, etc.). */
export function registerSessionCallbacks(callbacks: SessionCallbacks): void {
    _onOpened = callbacks.onOpened
    _onNavigate = callbacks.onNavigate
    _onSubmitted = callbacks.onSubmitted
    _onClosed = callbacks.onClosed
}

// ============================================================================
// CORE STATE
// ============================================================================

/** Run/project the session is bound to (set on openSession). */
const sessionContextAtom = atom<SessionContext | null>(null)

// --- Scenario source injection (two ways) ---
// 1. Reactive: the consumer hands a *reference* to its own scenarios atom (e.g.
//    `simpleQueueMolecule.selectors.scenarios(queueId)` or `evaluationScenarioMolecule
//    .selectors.list({projectId,runId})`) via `actions.setScenarioSource`. The engine reads
//    through it, so molecule updates/refetches flow in automatically — no effects.
// 2. Imperative: `actions.setScenarios({scenarios})` writes a static list (tests / non-atom
//    sources). The reactive source wins when set.
const scenariosSourceAtom = atom<Atom<SessionScenario[]> | null>(null)
const scenariosQuerySourceAtom = atom<Atom<SessionScenariosQueryState> | null>(null)
const imperativeScenariosAtom = atom<SessionScenario[]>([])
const imperativeScenariosQueryAtom = atom<SessionScenariosQueryState>({
    isPending: false,
    isError: false,
    data: null,
})

// Scenario-source KIND injection — the consumer's notion of what its scenarios are backed by
// ("traces" | "testcases" for annotation queues; the eval-run view injects its own). The engine
// stays source-agnostic: it never reads `simpleQueueMolecule`/`queueKind`. List-column
// derivations read this injected value to decide trace- vs testcase-shaped columns.
const scenarioKindSourceAtom = atom<Atom<string | null> | null>(null)
const imperativeScenarioKindAtom = atom<string | null>(null)

/** Effective scenario list — reactive source if injected, else the imperative value. */
const sessionScenariosAtom = atom<SessionScenario[]>((get) => {
    const src = get(scenariosSourceAtom)
    return src ? get(src) : get(imperativeScenariosAtom)
})

/** Effective scenario source query state. */
const sessionScenariosQueryAtom = atom<SessionScenariosQueryState>((get) => {
    const src = get(scenariosQuerySourceAtom)
    return src ? get(src) : get(imperativeScenariosQueryAtom)
})

/** Effective injected scenario-source kind — reactive source if injected, else imperative. */
const sessionScenarioKindAtom = atom<string | null>((get) => {
    const src = get(scenarioKindSourceAtom)
    return src ? get(src) : get(imperativeScenarioKindAtom)
})

/** Requested/focused scenario ID from route or navigation state */
const focusedScenarioIdAtom = atom<string | null>(null)

/** Stable session-local scenario order to avoid refetch reordering in focus mode. */
const scenarioOrderAtom = atom<string[]>([])

/** Set of locally-completed scenario IDs (optimistic overlay before refetch) */
const completedScenarioIdsAtom = atom<Set<string>>(new Set<string>())

/** Active view in the session ("list" | "annotate" | "configuration") */
const activeSessionViewAtom = atom<SessionView>("annotate")

const hideCompletedInFocusAtom = atom<boolean>(false)
const focusAutoNextAtom = atom<boolean>(true)

// ============================================================================
// DERIVED — scenario ordering
// ============================================================================

/** Scenario records with the stable session-local order applied. */
const scenarioRecordsAtom = atom<SessionScenario[]>((get) => {
    const records = get(sessionScenariosAtom)
    const orderedIds = get(scenarioOrderAtom)

    if (records.length === 0 || orderedIds.length === 0) return records

    const recordById = new Map<string, SessionScenario>()
    for (const record of records) {
        if (record.id) recordById.set(record.id, record)
    }

    const orderedRecords: SessionScenario[] = []
    const seen = new Set<string>()

    for (const id of orderedIds) {
        const record = recordById.get(id)
        if (!record) continue
        orderedRecords.push(record)
        seen.add(id)
    }

    for (const record of records) {
        if (!record.id || seen.has(record.id)) continue
        orderedRecords.push(record)
    }

    return orderedRecords
})

const scenarioIdsAtom = atom<string[]>((get) =>
    get(scenarioRecordsAtom)
        .map((s) => s.id || "")
        .filter(Boolean),
)

const scenariosQueryAtom = atom((get) => get(sessionScenariosQueryAtom))

// ============================================================================
// HELPERS (moved verbatim from annotationSessionController)
// ============================================================================

function getScenarioStatusValue({
    scenarioId,
    records,
    completed,
}: {
    scenarioId: string
    records: SessionScenario[]
    completed: Set<string>
}): string | null {
    if (completed.has(scenarioId)) return "success"
    const record = records.find((r) => r.id === scenarioId)
    return record?.status ?? null
}

function getNavigableScenarioIds({get, view}: {get: Getter; view?: SessionView}): string[] {
    const ids = get(scenarioIdsAtom)
    const activeView = view ?? get(activeSessionViewAtom)
    if (activeView !== "annotate") return ids

    const hideCompleted = get(hideCompletedInFocusAtom)
    const records = get(scenarioRecordsAtom)
    const completed = get(completedScenarioIdsAtom)

    return ids.filter((scenarioId) => {
        const status = getScenarioStatusValue({scenarioId, records, completed})
        if (hideCompleted && status === "success") return false
        return true
    })
}

function isScenarioCompleted(
    id: string,
    completed: Set<string>,
    records: SessionScenario[],
): boolean {
    if (completed.has(id)) return true
    const record = records.find((r) => r.id === id)
    return record?.status === "success"
}

function resolveFallbackScenarioId({
    ids,
    records,
    completed,
    view,
}: {
    ids: string[]
    records: SessionScenario[]
    completed: Set<string>
    view: SessionView
}): string | null {
    if (ids.length === 0) return null
    if (view === "annotate") {
        return ids.find((id) => !isScenarioCompleted(id, completed, records)) ?? ids[0] ?? null
    }
    return ids[0] ?? null
}

function resolveAdjacentNavigableScenarioId({
    get,
    direction,
}: {
    get: Getter
    direction: "next" | "prev"
}): string | null {
    const ids = get(navigableScenarioIdsAtom)
    if (ids.length === 0) return null

    const currentId = get(focusedScenarioIdAtom) ?? get(currentScenarioIdAtom)
    if (!currentId) {
        return direction === "next" ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null)
    }

    const visibleIndex = ids.indexOf(currentId)
    if (visibleIndex >= 0) {
        return direction === "next"
            ? (ids[visibleIndex + 1] ?? null)
            : (ids[visibleIndex - 1] ?? null)
    }

    const allIds = get(scenarioIdsAtom)
    const currentIndex = allIds.indexOf(currentId)
    if (currentIndex < 0) {
        return direction === "next" ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null)
    }

    const matches = ids.filter((id) => {
        const idIndex = allIds.indexOf(id)
        return direction === "next" ? idIndex > currentIndex : idIndex < currentIndex
    })

    return direction === "next" ? (matches[0] ?? null) : (matches[matches.length - 1] ?? null)
}

function setFocusedScenarioId({
    get,
    set,
    scenarioId,
    notify = false,
}: {
    get: Getter
    set: Setter
    scenarioId: string | null
    notify?: boolean
}) {
    const previousScenarioId = get(currentScenarioIdAtom)
    set(focusedScenarioIdAtom, scenarioId)

    if (!notify || !scenarioId || scenarioId === previousScenarioId) return

    const ids = get(navigableScenarioIdsAtom)
    const index = ids.indexOf(scenarioId)
    if (index >= 0) {
        _onNavigate?.(scenarioId, index)
    }
}

// ============================================================================
// DERIVED — navigation / progress
// ============================================================================

const navigableScenarioIdsAtom = atom<string[]>((get) => getNavigableScenarioIds({get}))

const isActiveAtom = atom<boolean>((get) => get(sessionContextAtom) !== null)

const activeRunIdAtom = atom<string | null>((get) => get(sessionContextAtom)?.runId ?? null)

const currentScenarioIdAtom = atom<string | null>((get) => {
    const allIds = get(scenarioIdsAtom)
    if (allIds.length === 0) return null

    const focusedScenarioId = get(focusedScenarioIdAtom)
    if (focusedScenarioId && allIds.includes(focusedScenarioId)) {
        return focusedScenarioId
    }

    const visibleIds = get(navigableScenarioIdsAtom)
    if (visibleIds.length > 0) return visibleIds[0] ?? null

    return allIds[0] ?? null
})

const currentScenarioIndexAtom = atom<number>((get) => {
    const ids = get(scenarioIdsAtom)
    const currentScenarioId = get(currentScenarioIdAtom)
    if (!currentScenarioId) return 0
    const index = ids.indexOf(currentScenarioId)
    return index >= 0 ? index : 0
})

const hasNextAtom = atom<boolean>(
    (get) => resolveAdjacentNavigableScenarioId({get, direction: "next"}) !== null,
)

const hasPrevAtom = atom<boolean>(
    (get) => resolveAdjacentNavigableScenarioId({get, direction: "prev"}) !== null,
)

const progressAtom = atom<SessionProgress>((get) => {
    const ids = get(scenarioIdsAtom)
    const records = get(scenarioRecordsAtom)
    const locallyCompleted = get(completedScenarioIdsAtom)
    const completedCount = ids.filter((id) => {
        if (locallyCompleted.has(id)) return true
        const record = records.find((r) => r.id === id)
        return record?.status === "success"
    }).length
    return {
        total: ids.length,
        completed: completedCount,
        remaining: ids.length - completedCount,
        currentIndex: get(currentScenarioIndexAtom),
    }
})

const isCurrentCompletedAtom = atom<boolean>((get) => {
    const currentId = get(currentScenarioIdAtom)
    if (!currentId) return false
    if (get(completedScenarioIdsAtom).has(currentId)) return true
    const record = get(scenarioRecordsAtom).find((r) => r.id === currentId)
    return record?.status === "success"
})

const scenarioStatusesAtom = atom<Record<string, string | null>>((get) => {
    const records = get(scenarioRecordsAtom)
    const completed = get(completedScenarioIdsAtom)
    const map: Record<string, string | null> = {}
    for (const s of records) {
        if (!s.id) continue
        map[s.id] = completed.has(s.id)
            ? "success"
            : getScenarioStatusValue({scenarioId: s.id, records, completed})
    }
    return map
})

// ============================================================================
// ACTIONS
// ============================================================================

/**
 * Inject a REACTIVE scenario source — a reference to the consumer's own scenarios atom (and
 * optional query-state atom). The engine reads through it, so molecule updates flow in with no
 * effects. Pass `null` to clear. This is the path real consumers use.
 */
const setScenarioSourceAtom = atom(
    null,
    (
        _get,
        set,
        payload: {
            scenarios: Atom<SessionScenario[]> | null
            query?: Atom<SessionScenariosQueryState> | null
            kind?: Atom<string | null> | null
        },
    ) => {
        set(scenariosSourceAtom, payload.scenarios)
        set(scenariosQuerySourceAtom, payload.query ?? null)
        if (payload.kind !== undefined) set(scenarioKindSourceAtom, payload.kind)
    },
)

/** Inject a STATIC scenario list (tests / non-atom sources). Reactive source wins if set. */
const setScenariosAtom = atom(
    null,
    (
        _get,
        set,
        payload: {
            scenarios: SessionScenario[]
            query?: SessionScenariosQueryState
            kind?: string | null
        },
    ) => {
        set(imperativeScenariosAtom, payload.scenarios)
        if (payload.query) set(imperativeScenariosQueryAtom, payload.query)
        if (payload.kind !== undefined) set(imperativeScenarioKindAtom, payload.kind)
    },
)

const syncScenarioOrderAtom = atom(null, (get, set) => {
    const nextIds = get(sessionScenariosAtom)
        .map((record) => record.id || "")
        .filter(Boolean)

    if (nextIds.length === 0) {
        if (get(scenarioOrderAtom).length > 0) set(scenarioOrderAtom, [])
        return
    }

    const currentIds = get(scenarioOrderAtom)
    const nextIdSet = new Set(nextIds)
    const mergedIds = currentIds.filter((id) => nextIdSet.has(id))
    const seen = new Set(mergedIds)

    for (const id of nextIds) {
        if (seen.has(id)) continue
        mergedIds.push(id)
        seen.add(id)
    }

    if (
        mergedIds.length === currentIds.length &&
        mergedIds.every((id, index) => currentIds[index] === id)
    ) {
        return
    }

    set(scenarioOrderAtom, mergedIds)
})

const openSessionAtom = atom(null, (_get, set, payload: OpenSessionPayload) => {
    const {projectId, runId, initialView, initialScenarioId} = payload

    set(sessionContextAtom, {projectId, runId})
    set(focusedScenarioIdAtom, initialScenarioId ?? null)
    set(completedScenarioIdsAtom, new Set())
    set(scenarioOrderAtom, [])
    set(activeSessionViewAtom, initialView ?? "annotate")
    set(hideCompletedInFocusAtom, false)
    set(focusAutoNextAtom, true)

    _onOpened?.({projectId, runId})
})

const navigateNextAtom = atom(null, (get, set) => {
    const scenarioId = resolveAdjacentNavigableScenarioId({get, direction: "next"})
    if (scenarioId) setFocusedScenarioId({get, set, scenarioId, notify: true})
})

const navigatePrevAtom = atom(null, (get, set) => {
    const scenarioId = resolveAdjacentNavigableScenarioId({get, direction: "prev"})
    if (scenarioId) setFocusedScenarioId({get, set, scenarioId, notify: true})
})

const navigateToIndexAtom = atom(null, (get, set, index: number) => {
    const ids = get(navigableScenarioIdsAtom)
    if (index >= 0 && index < ids.length) {
        setFocusedScenarioId({get, set, scenarioId: ids[index], notify: true})
    }
})

const markCompletedAtom = atom(null, (get, set, scenarioId: string) => {
    const next = new Set(get(completedScenarioIdsAtom))
    next.add(scenarioId)
    set(completedScenarioIdsAtom, next)
})

const completeAndAdvanceAtom = atom(null, (get, set) => {
    const currentId = get(currentScenarioIdAtom)
    if (currentId) {
        set(markCompletedAtom, currentId)
        _onSubmitted?.(currentId)
    }
    const nextScenarioId = resolveAdjacentNavigableScenarioId({get, direction: "next"})
    if (nextScenarioId) setFocusedScenarioId({get, set, scenarioId: nextScenarioId, notify: true})
})

const setActiveViewAtom = atom(null, (get, set, view: SessionView) => {
    set(activeSessionViewAtom, view)
    if (view !== "annotate") return

    const focusedScenarioId = get(focusedScenarioIdAtom)
    const allIds = get(scenarioIdsAtom)
    if (focusedScenarioId && allIds.includes(focusedScenarioId)) {
        setFocusedScenarioId({get, set, scenarioId: focusedScenarioId})
        return
    }

    const currentScenarioId = get(currentScenarioIdAtom)
    if (currentScenarioId && allIds.includes(currentScenarioId)) {
        set(focusedScenarioIdAtom, currentScenarioId)
        return
    }

    const ids = getNavigableScenarioIds({get, view})
    const records = get(scenarioRecordsAtom)
    const completed = get(completedScenarioIdsAtom)
    const fallbackScenarioId = resolveFallbackScenarioId({ids, records, completed, view})
    if (fallbackScenarioId) setFocusedScenarioId({get, set, scenarioId: fallbackScenarioId})
})

const setHideCompletedInFocusAtom = atom(null, (get, set, hideCompleted: boolean) => {
    const previousScenarioId = get(currentScenarioIdAtom)
    set(hideCompletedInFocusAtom, hideCompleted)

    const ids = get(navigableScenarioIdsAtom)
    if (previousScenarioId && ids.includes(previousScenarioId)) {
        setFocusedScenarioId({get, set, scenarioId: previousScenarioId, notify: true})
        return
    }
    if (ids.length === 0) {
        setFocusedScenarioId({get, set, scenarioId: null, notify: true})
        return
    }

    const records = get(scenarioRecordsAtom)
    const completed = get(completedScenarioIdsAtom)
    const fallbackScenarioId = resolveFallbackScenarioId({
        ids,
        records,
        completed,
        view: "annotate",
    })
    setFocusedScenarioId({get, set, scenarioId: fallbackScenarioId, notify: true})
})

const setFocusAutoNextAtom = atom(null, (_get, set, autoNext: boolean) => {
    set(focusAutoNextAtom, autoNext)
})

const applyRouteStateAtom = atom(null, (get, set, payload: ApplyRouteStatePayload) => {
    const nextView = payload.view ?? get(activeSessionViewAtom)
    set(activeSessionViewAtom, nextView)

    const allIds = get(scenarioIdsAtom)
    const ids = getNavigableScenarioIds({get, view: nextView})
    const requestedScenarioId =
        payload.scenarioId === undefined ? get(focusedScenarioIdAtom) : payload.scenarioId

    if (requestedScenarioId && allIds.includes(requestedScenarioId)) {
        setFocusedScenarioId({get, set, scenarioId: requestedScenarioId, notify: true})
        return
    }
    if (allIds.length === 0) {
        set(focusedScenarioIdAtom, null)
        return
    }

    const records = get(scenarioRecordsAtom)
    const completed = get(completedScenarioIdsAtom)
    const fallbackScenarioId = resolveFallbackScenarioId({ids, records, completed, view: nextView})
    setFocusedScenarioId({get, set, scenarioId: fallbackScenarioId, notify: true})
})

const closeSessionAtom = atom(null, (_get, set) => {
    set(sessionContextAtom, null)
    set(scenariosSourceAtom, null)
    set(scenariosQuerySourceAtom, null)
    set(scenarioKindSourceAtom, null)
    set(imperativeScenariosAtom, [])
    set(imperativeScenariosQueryAtom, {isPending: false, isError: false, data: null})
    set(imperativeScenarioKindAtom, null)
    set(focusedScenarioIdAtom, null)
    set(completedScenarioIdsAtom, new Set())
    set(scenarioOrderAtom, [])
    set(activeSessionViewAtom, "annotate")
    set(hideCompletedInFocusAtom, false)
    set(focusAutoNextAtom, true)
    _onClosed?.()
})

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

export const evaluationSessionController = {
    selectors: {
        isActive: () => isActiveAtom,
        context: () => sessionContextAtom,
        activeRunId: () => activeRunIdAtom,
        scenarioRecords: () => scenarioRecordsAtom,
        scenarioIds: () => scenarioIdsAtom,
        scenariosQuery: () => scenariosQueryAtom,
        /** Injected scenario-source kind ("traces" | "testcases" | null) — list-column shaping. */
        scenarioKind: () => sessionScenarioKindAtom,
        navigableScenarioIds: () => navigableScenarioIdsAtom,
        currentScenarioId: () => currentScenarioIdAtom,
        currentScenarioIndex: () => currentScenarioIndexAtom,
        focusedScenarioId: () => focusedScenarioIdAtom,
        hasNext: () => hasNextAtom,
        hasPrev: () => hasPrevAtom,
        progress: () => progressAtom,
        isCurrentCompleted: () => isCurrentCompletedAtom,
        scenarioStatuses: () => scenarioStatusesAtom,
        /** Locally-completed scenario IDs (optimistic overlay). */
        completedScenarioIds: () => completedScenarioIdsAtom,
        activeView: () => activeSessionViewAtom,
        hideCompletedInFocus: () => hideCompletedInFocusAtom,
        focusAutoNext: () => focusAutoNextAtom,
    },
    actions: {
        /** Inject a reactive scenario source (atom ref) — the path real consumers use. */
        setScenarioSource: setScenarioSourceAtom,
        /** Inject a static scenario list (tests / non-atom sources). */
        setScenarios: setScenariosAtom,
        openSession: openSessionAtom,
        navigateNext: navigateNextAtom,
        navigatePrev: navigatePrevAtom,
        navigateToIndex: navigateToIndexAtom,
        syncScenarioOrder: syncScenarioOrderAtom,
        markCompleted: markCompletedAtom,
        completeAndAdvance: completeAndAdvanceAtom,
        setActiveView: setActiveViewAtom,
        setHideCompletedInFocus: setHideCompletedInFocusAtom,
        setFocusAutoNext: setFocusAutoNextAtom,
        applyRouteState: applyRouteStateAtom,
        closeSession: closeSessionAtom,
    },
}

export type EvaluationSessionController = typeof evaluationSessionController
