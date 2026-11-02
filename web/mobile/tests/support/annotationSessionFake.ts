import {atom, createStore, type Atom, type Getter, type Setter, type WritableAtom} from "jotai"

/**
 * Stand-ins for `annotationSessionController` and `annotationFormController` from
 * `@agenta/annotation`, for the /m queue session screens.
 *
 * Every selector reads one plain state object, so a case sets the state it needs and renders. Every
 * action records its payload in `calls`; a case can give an action a body (`handlers`) when the
 * screen should see its effect, for example a failing submit. No request is ever sent.
 *
 * Use it from a `vi.mock("@agenta/annotation", ...)` factory:
 * `const {annotationModuleFake} = await import("../support/annotationSessionFake")`.
 */

export interface FakeMetricField {
    value: unknown
    type?: string | string[]
    minimum?: number
    maximum?: number
    enum?: unknown[]
    items?: {type?: string; enum?: string[]}
}

export interface FakeSessionState {
    activeQueueId: string | null
    activeView: "annotate" | "list" | "configuration"
    currentScenarioId: string | null
    scenarioIds: string[]
    focusScenarioIds: string[]
    scenarioRecords: Record<string, unknown>[]
    scenarioStatuses: Record<string, string | null>
    scenariosQuery: {isPending: boolean; isError: boolean; data: unknown}
    queueKind: string | null
    queueName: string | null
    queueDescription: string | null
    progress: {total: number; completed: number; remaining: number; currentIndex: number}
    hasNext: boolean
    hasPrev: boolean
    hideCompletedInFocus: boolean
    focusAutoNext: boolean
    isAddToTestsetModalOpen: boolean
    pendingTestsetSelection: string | null
    addToTestsetExportJob: {
        id: string
        status: string
        total: number
        processed: number
        targetTestsetId?: string
        targetTestsetName?: string
    }
    isAddToTestsetExporting: boolean
    canAddToTestset: boolean
    selectedScenarioIds: string[]
    listColumnDefs: unknown[]
    evaluatorStepRefs: unknown[]
    evaluatorIds: string[]
    traceRefs: Record<string, {traceId: string; spanId: string}>
    testcaseRefs: Record<string, {testcaseId: string}>
    testcases: Record<string, {isPending: boolean; isError: boolean; data: unknown}>
    /** Metric values by `${scenarioId}:${path}`. */
    metricValues: Record<string, unknown>
    // Form controller
    metrics: Record<string, Record<string, Record<string, FakeMetricField>>>
    evaluators: {slug?: string | null; name?: string | null}[]
    evaluatorResolution: {isPending: boolean; hasError: boolean}
    isSubmitting: Record<string, boolean>
    hasFilledMetrics: Record<string, boolean>
    hasPendingChanges: Record<string, boolean>
    submitError: Record<string, string | null>
}

export const initialSessionState = (): FakeSessionState => ({
    activeQueueId: "queue-1",
    activeView: "annotate",
    currentScenarioId: "s-1",
    scenarioIds: ["s-1", "s-2"],
    focusScenarioIds: ["s-1", "s-2"],
    scenarioRecords: [
        {id: "s-1", status: "pending"},
        {id: "s-2", status: "pending"},
    ],
    scenarioStatuses: {"s-1": "pending", "s-2": "pending"},
    scenariosQuery: {isPending: false, isError: false, data: []},
    queueKind: "traces",
    queueName: "Support replies",
    queueDescription: null,
    progress: {total: 2, completed: 0, remaining: 2, currentIndex: 0},
    hasNext: true,
    hasPrev: false,
    hideCompletedInFocus: false,
    focusAutoNext: true,
    isAddToTestsetModalOpen: false,
    pendingTestsetSelection: null,
    addToTestsetExportJob: {id: "", status: "idle", total: 0, processed: 0},
    isAddToTestsetExporting: false,
    canAddToTestset: true,
    selectedScenarioIds: [],
    listColumnDefs: [],
    evaluatorStepRefs: [{slug: "tone"}],
    evaluatorIds: [],
    traceRefs: {},
    testcaseRefs: {},
    testcases: {},
    metricValues: {},
    metrics: {},
    evaluators: [{slug: "tone", name: "Tone"}],
    evaluatorResolution: {isPending: false, hasError: false},
    isSubmitting: {},
    hasFilledMetrics: {},
    hasPendingChanges: {},
    submitError: {},
})

export const fakeStore = createStore()
export const sessionStateAtom = atom<FakeSessionState>(initialSessionState())
export const calls: [string, unknown][] = []
type Handler = (get: Getter, set: Setter, payload: unknown) => unknown
export const handlers: Record<string, Handler> = {}

export const resetSession = (patch: Partial<FakeSessionState> = {}) => {
    calls.length = 0
    for (const key of Object.keys(handlers)) delete handlers[key]
    fakeStore.set(sessionStateAtom, {...initialSessionState(), ...patch})
}
export const patchSession = (patch: Partial<FakeSessionState>) =>
    fakeStore.set(sessionStateAtom, (state) => ({...state, ...patch}))
export const callsOf = (name: string) => calls.filter(([n]) => n === name).map(([, p]) => p)

const cache = new Map<string, Atom<unknown>>()
const read = <T>(key: string, pick: (state: FakeSessionState) => T): Atom<T> => {
    let found = cache.get(key)
    if (!found) {
        found = atom((get) => pick(get(sessionStateAtom)))
        cache.set(key, found)
    }
    return found as Atom<T>
}

const action = (name: string): WritableAtom<null, [unknown?], unknown> =>
    atom(null, (get, set, payload?: unknown) => {
        calls.push([name, payload])
        return handlers[name]?.(get, set, payload)
    })

const NO_TRACE = {traceId: "", spanId: ""}
const NO_TESTCASE = {testcaseId: ""}
const NO_ANNOTATIONS: unknown[] = []
const IDLE_QUERY = {isPending: true, isError: false, data: null}

export const annotationSessionController = {
    selectors: {
        activeQueueId: () => read("activeQueueId", (s) => s.activeQueueId),
        activeView: () => read("activeView", (s) => s.activeView),
        currentScenarioId: () => read("currentScenarioId", (s) => s.currentScenarioId),
        scenarioIds: () => read("scenarioIds", (s) => s.scenarioIds),
        focusScenarioIds: () => read("focusScenarioIds", (s) => s.focusScenarioIds),
        scenarioRecords: () => read("scenarioRecords", (s) => s.scenarioRecords),
        scenarioStatuses: () => read("scenarioStatuses", (s) => s.scenarioStatuses),
        scenariosQuery: () => read("scenariosQuery", (s) => s.scenariosQuery),
        queueKind: () => read("queueKind", (s) => s.queueKind),
        queueName: () => read("queueName", (s) => s.queueName),
        queueDescription: () => read("queueDescription", (s) => s.queueDescription),
        progress: () => read("progress", (s) => s.progress),
        hasNext: () => read("hasNext", (s) => s.hasNext),
        hasPrev: () => read("hasPrev", (s) => s.hasPrev),
        hideCompletedInFocus: () => read("hideCompletedInFocus", (s) => s.hideCompletedInFocus),
        focusAutoNext: () => read("focusAutoNext", (s) => s.focusAutoNext),
        isAddToTestsetModalOpen: () =>
            read("isAddToTestsetModalOpen", (s) => s.isAddToTestsetModalOpen),
        pendingTestsetSelection: () =>
            read("pendingTestsetSelection", (s) => s.pendingTestsetSelection),
        addToTestsetExportJob: () => read("addToTestsetExportJob", (s) => s.addToTestsetExportJob),
        isAddToTestsetExporting: () =>
            read("isAddToTestsetExporting", (s) => s.isAddToTestsetExporting),
        canAddToTestset: () => read("canAddToTestset", (s) => s.canAddToTestset),
        selectedScenarioIds: () => read("selectedScenarioIds", (s) => s.selectedScenarioIds),
        listColumnDefs: () => read("listColumnDefs", (s) => s.listColumnDefs),
        evaluatorStepRefs: () => read("evaluatorStepRefs", (s) => s.evaluatorStepRefs),
        evaluatorIds: () => read("evaluatorIds", (s) => s.evaluatorIds),
        scenarioTraceRef: (id: string) => read(`trace:${id}`, (s) => s.traceRefs[id] ?? NO_TRACE),
        scenarioTestcaseRef: (id: string) =>
            read(`testcase:${id}`, (s) => s.testcaseRefs[id] ?? NO_TESTCASE),
        scenarioAnnotations: (id: string) => read(`annotations:${id}`, () => NO_ANNOTATIONS),
        testcaseData: (id: string) =>
            read(`testcaseData:${id}`, (s) => s.testcases[id] ?? IDLE_QUERY),
        scenarioMetricForEvaluator: (key: {scenarioId: string; path?: string | null}) =>
            read(`metric:${key.scenarioId}:${key.path}`, (s) => ({
                value: s.metricValues[`${key.scenarioId}:${key.path}`] ?? null,
                stats: undefined,
                annotation: null,
            })),
    },
    actions: {
        openQueue: action("openQueue"),
        closeSession: action("closeSession"),
        applyRouteState: action("applyRouteState"),
        setActiveView: action("setActiveView"),
        syncScenarioOrder: action("syncScenarioOrder"),
        navigateNext: action("navigateNext"),
        navigatePrev: action("navigatePrev"),
        navigateToIndex: action("navigateToIndex"),
        setHideCompletedInFocus: action("setHideCompletedInFocus"),
        setFocusAutoNext: action("setFocusAutoNext"),
        openAddToTestsetModal: action("openAddToTestsetModal"),
        closeAddToTestsetModal: action("closeAddToTestsetModal"),
        setPendingTestsetSelection: action("setPendingTestsetSelection"),
        addScenariosToTestset: action("addScenariosToTestset"),
        setSelectedScenarioIds: action("setSelectedScenarioIds"),
    },
}

export const annotationFormController = {
    selectors: {
        effectiveMetrics: (id: string) => read(`metrics:${id}`, (s) => s.metrics[id] ?? {}),
        evaluators: (id: string) => read(`evaluators:${id}`, (s) => s.evaluators),
        evaluatorResolution: () => read("evaluatorResolution", (s) => s.evaluatorResolution),
        isSubmitting: (id: string) =>
            read(`isSubmitting:${id}`, (s) => s.isSubmitting[id] ?? false),
        hasFilledMetrics: (id: string) =>
            read(`hasFilledMetrics:${id}`, (s) => s.hasFilledMetrics[id] ?? false),
        hasPendingChanges: (id: string) =>
            read(`hasPendingChanges:${id}`, (s) => s.hasPendingChanges[id] ?? false),
        submitError: (id: string) => read(`submitError:${id}`, (s) => s.submitError[id] ?? null),
    },
    actions: {
        setScenarioContext: action("setScenarioContext"),
        updateMetric: action("updateMetric"),
        submitAnnotations: action("submitAnnotations"),
        clearSubmitError: action("clearSubmitError"),
        clearFormState: action("clearFormState"),
    },
}

export const registerAnnotationCallbacks = (callbacks: {
    onNavigate?: (id: string, index: number) => void
}) => {
    calls.push(["registerAnnotationCallbacks", callbacks])
}
