import {projectPermissionQueryKey} from "@agenta/entities/access"
import type {QueryKey} from "@tanstack/react-query"
import type {Getter, Setter} from "jotai"

import {
    handlers,
    initialSessionState,
    sessionStateAtom,
    type FakeSessionState,
} from "../../mobile/tests/support/annotationSessionFake"

import {traceRootSpan} from "./trace"

/**
 * `@agenta/annotation` as the /m annotation session screens see it in Storybook (wired by an
 * alias in `.storybook/main.ts` that applies only to `mobile/src/features/annotations/`).
 *
 * The real controllers need a live queue, its evaluation run, the evaluator revisions and the
 * annotations behind it. The stories swap in the controller stand-in the unit tests use, whose
 * selectors read one state object, and keep every other export real.
 */
export * from "../../packages/agenta-annotation/src/index"
export {
    annotationFormController,
    annotationSessionController,
    registerAnnotationCallbacks,
} from "../../mobile/tests/support/annotationSessionFake"
export {initialSessionState, sessionStateAtom, type FakeSessionState}

const update = (set: Setter, change: (state: FakeSessionState) => Partial<FakeSessionState>) =>
    set(sessionStateAtom, (state) => ({...state, ...change(state)}))

const move = (get: Getter, set: Setter, step: number) => {
    const state = get(sessionStateAtom)
    const ids = state.focusScenarioIds
    const index = Math.min(
        Math.max(ids.indexOf(state.currentScenarioId ?? "") + step, 0),
        ids.length - 1,
    )
    update(set, () => ({
        currentScenarioId: ids[index] ?? null,
        hasPrev: index > 0,
        hasNext: index < ids.length - 1,
    }))
}

/** Gives the stand-in's actions enough behavior for a story to be clicked through. */
export const installStoryHandlers = () => {
    handlers.updateMetric = (_get, set, payload) => {
        const {scenarioId, slug, fieldKey, value} = payload as {
            scenarioId: string
            slug: string
            fieldKey: string
            value: unknown
        }
        update(set, (state) => {
            const scenario = state.metrics[scenarioId] ?? {}
            const fields = scenario[slug] ?? {}
            return {
                metrics: {
                    ...state.metrics,
                    [scenarioId]: {
                        ...scenario,
                        [slug]: {...fields, [fieldKey]: {...fields[fieldKey], value}},
                    },
                },
                hasFilledMetrics: {...state.hasFilledMetrics, [scenarioId]: value !== null},
                hasPendingChanges: {...state.hasPendingChanges, [scenarioId]: true},
            }
        })
    }
    handlers.submitAnnotations = async (_get, set, payload) => {
        const {scenarioId} = payload as {scenarioId: string}
        update(set, (state) => ({
            scenarioStatuses: {...state.scenarioStatuses, [scenarioId]: "success"},
            hasPendingChanges: {...state.hasPendingChanges, [scenarioId]: false},
        }))
    }
    handlers.navigateNext = (get, set) => move(get, set, 1)
    handlers.navigatePrev = (get, set) => move(get, set, -1)
    handlers.navigateToIndex = (get, set, index) => {
        const ids = get(sessionStateAtom).focusScenarioIds
        update(set, () => ({currentScenarioId: ids[index as number] ?? null}))
        move(get, set, 0)
    }
    handlers.setHideCompletedInFocus = (_get, set, value) =>
        update(set, () => ({hideCompletedInFocus: value as boolean}))
    handlers.setFocusAutoNext = (_get, set, value) =>
        update(set, () => ({focusAutoNext: value as boolean}))
    handlers.setSelectedScenarioIds = (_get, set, ids) =>
        update(set, () => ({selectedScenarioIds: ids as string[]}))
}

/** A trace item: its id and what its root span read and wrote. */
export interface StoryTrace {
    traceId: string
    name: string
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
}

/**
 * The query cache entries the trace overview reads for each trace (`["trace-entity", ...]` and
 * the root span's `["span", ...]`), plus the `view_spans` permission that gates them.
 */
export const traceQueries = (projectId: string, traces: StoryTrace[]): [QueryKey, unknown][] => [
    [projectPermissionQueryKey(projectId, "view_spans"), true],
    ...traces.flatMap(({traceId, name, inputs, outputs}): [QueryKey, unknown][] => {
        const spanId = `${traceId}-root`
        const span = traceRootSpan(
            {projectId, traceId, spanId},
            {
                span_name: name,
                attributes: {ag: {data: {inputs, outputs}, type: {node: "workflow"}}},
            },
        )
        return [
            [
                ["trace-entity", projectId, traceId],
                {traces: {[traceId]: {spans: {[spanId]: span}}}},
            ],
            [["span", projectId, spanId], span],
        ]
    }),
]

const TONE_FIELDS = {
    friendly: {value: null, type: "boolean"},
    score: {value: null, type: "integer", minimum: 1, maximum: 5},
    comment: {value: null, type: "string"},
}
const ACCURACY_FIELDS = {
    verdict: {value: null, type: ["string", "null"], enum: ["correct", "partly", "wrong", null]},
    issues: {
        value: null,
        type: "array",
        items: {type: "string", enum: ["tone", "facts", "length"]},
    },
}

export const STORY_TRACES: StoryTrace[] = [
    {
        traceId: "trace-refund",
        name: "answer_refund_question",
        inputs: {question: "Can I get a refund after 30 days?"},
        outputs: {answer: "Refunds are possible within 60 days of purchase."},
    },
    {
        traceId: "trace-shipping",
        name: "answer_shipping_question",
        inputs: {question: "How long does shipping take?"},
        outputs: {answer: "Standard shipping takes three to five days."},
    },
    {
        traceId: "trace-invoice",
        name: "answer_invoice_question",
        inputs: {question: "Where do I find my invoice?"},
        outputs: {answer: "Open Billing, then Invoices."},
    },
]

const TONE_COLUMN = {
    columnType: "annotation",
    key: "tone",
    title: "Tone",
    width: 200,
    outputKeys: ["friendly", "score"],
    annotationDef: {evaluatorSlug: "tone", path: null, stepKey: "step-tone"},
    outputColumns: ["friendly", "score"].map((name) => ({
        key: `tone_${name}`,
        title: name,
        annotationDef: {evaluatorSlug: "tone", path: name, stepKey: "step-tone"},
    })),
}

/** A trace queue of three items: the first one completed, the second one open. */
export const traceQueueState = (patch: Partial<FakeSessionState> = {}): FakeSessionState => {
    const ids = ["s-1", "s-2", "s-3"]
    return {
        ...initialSessionState(),
        queueName: "Support replies",
        queueDescription: "Rate each reply for **tone** and **accuracy**.",
        currentScenarioId: "s-2",
        scenarioIds: ids,
        focusScenarioIds: ids,
        scenarioRecords: ids.map((id, i) => ({id, tags: {trace_id: STORY_TRACES[i].traceId}})),
        scenarioStatuses: {"s-1": "success", "s-2": "pending", "s-3": "failure"},
        progress: {total: 3, completed: 1, remaining: 2, currentIndex: 1},
        hasPrev: true,
        hasNext: true,
        traceRefs: Object.fromEntries(
            ids.map((id, i) => [
                id,
                {traceId: STORY_TRACES[i].traceId, spanId: `${STORY_TRACES[i].traceId}-root`},
            ]),
        ),
        evaluatorStepRefs: [{slug: "tone"}, {slug: "accuracy"}],
        evaluators: [
            {slug: "tone", name: "Tone"},
            {slug: "accuracy", name: "Accuracy"},
        ],
        metrics: Object.fromEntries(
            ids.map((id) => [id, {tone: TONE_FIELDS, accuracy: ACCURACY_FIELDS}]),
        ) as FakeSessionState["metrics"],
        listColumnDefs: [TONE_COLUMN],
        metricValues: {"s-1:friendly": true, "s-1:score": 4},
        ...patch,
    }
}

/** The same queue over test cases. */
export const testcaseQueueState = (patch: Partial<FakeSessionState> = {}): FakeSessionState =>
    traceQueueState({
        queueKind: "testcases",
        traceRefs: {},
        scenarioRecords: [
            {id: "s-1", testcase_id: "tc-1"},
            {id: "s-2", testcase_id: "tc-2"},
            {id: "s-3", testcase_id: "tc-3"},
        ],
        testcaseRefs: {
            "s-1": {testcaseId: "tc-1"},
            "s-2": {testcaseId: "tc-2"},
            "s-3": {testcaseId: "tc-3"},
        },
        testcases: Object.fromEntries(
            STORY_TRACES.map((trace, i) => [
                `tc-${i + 1}`,
                {
                    isPending: false,
                    isError: false,
                    data: {
                        data: {
                            question: trace.inputs.question,
                            expected_output: trace.outputs.answer,
                            output: trace.outputs.answer,
                        },
                    },
                },
            ]),
        ),
        ...patch,
    })
