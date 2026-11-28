// @vitest-environment jsdom
/**
 * The queue's Annotate tab: the three columns, the item list with its groups and progress, the
 * folded list, the content bar and its More menu, the content drawn by shape, the one primary
 * button, the all completed line, the read only panel, a run's item with no output, and the
 * refresh after a save. The controllers are the shared fake, so no request is sent.
 */
import {act} from "react"

import {evaluationRunMolecule, evaluationRunQueryAtomFamily} from "@agenta/entities/evaluationRun"
import {Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    toast: {success: vi.fn(), error: vi.fn()},
    openTrace: vi.fn(),
    onSaved: vi.fn(),
    copy: vi.fn(async () => true),
    runApp: vi.fn(),
    canAnnotate: true,
    /** The window is at least 1,360px wide (the list starts open). */
    wide: true,
    invocationPending: false,
}))

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
        annotationFormController: fake.annotationFormController,
    }
})
vi.mock("@agenta/entities/trace", async (importOriginal) => {
    const {atom} = await import("jotai")
    const llm = {
        span_id: "span-llm",
        span_name: "chat",
        start_time: "2026-11-26T10:00:00Z",
        attributes: {
            ag: {
                data: {
                    inputs: {messages: [{role: "user", content: "I want to automate my outreach"}]},
                },
            },
        },
    }
    const root = {
        span_id: "span-root",
        span_name: "answer_question",
        start_time: "2026-11-26T10:00:00Z",
        spans: {"span-llm": llm},
        attributes: {
            ag: {
                data: {
                    inputs: {title: "Outreach fix", brief: "Find new clients."},
                    outputs: [
                        {role: "user", content: "I want to automate my outreach"},
                        {role: "assistant", content: "I'll look at what your project has."},
                    ],
                },
                metrics: {duration: {cumulative: 61000}},
            },
        },
    }
    const loaded = atom({
        isPending: false,
        isError: false,
        data: {traces: {"trace-1": {spans: {"span-root": root}}}},
        refetch: vi.fn(),
    })
    const span = atom(root)
    const failed = atom({isPending: false, isError: true, data: undefined, refetch: vi.fn()})
    const noSpan = atom(null)
    const failedSpan = atom({
        ...root,
        status_code: "STATUS_CODE_ERROR",
        events: [
            {
                name: "exception",
                attributes: {"exception.message": "the model provider returned 429"},
            },
        ],
    })
    return {
        ...(await importOriginal<typeof import("@agenta/entities/trace")>()),
        traceEntityAtomFamily: (traceId: string | null) =>
            traceId === "trace-missing" ? failed : loaded,
        traceRootSpanAtomFamily: (traceId: string | null) =>
            traceId === "trace-missing" ? noSpan : traceId === "trace-failed" ? failedSpan : span,
    }
})
vi.mock("@agenta/entities/evaluationRun", async (importOriginal) => {
    const {atom} = await import("jotai")
    // One atom each, as the real families give: a new atom per render would render forever.
    const run = atom<{data: unknown; isSuccess?: boolean; isError?: boolean}>({
        data: null,
        isSuccess: true,
        isError: false,
    })
    const steps = atom<{data: unknown[]; isSuccess: boolean; isError: boolean}>({
        data: [],
        isSuccess: true,
        isError: false,
    })
    return {
        ...(await importOriginal<typeof import("@agenta/entities/evaluationRun")>()),
        evaluationRunQueryAtomFamily: () => run,
        evaluationRunMolecule: {selectors: {scenarioSteps: () => steps}},
    }
})
vi.mock("@agenta/entities/shared", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/shared")>()),
    UserAuthorLabel: ({userId, at}: {userId: string; at: string}) => (
        <span>{`By ${userId}, ${at}`}</span>
    ),
}))
vi.mock("@agenta/observability/traceDrawer", async () => {
    const {atom} = await import("jotai")
    return {openTraceDrawerAtom: atom(null, (_get, _set, payload) => fixture.openTrace(payload))}
})
vi.mock("@agenta/ui/app-message", () => ({message: fixture.toast}))
vi.mock("@agenta/ui/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/utils")>()),
    copyToClipboard: fixture.copy,
}))
vi.mock("@agenta/ui/hooks", () => ({
    useMediaQuery: (query: string) => (query.includes("1360") ? fixture.wide : true),
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => fixture.canAnnotate,
}))
vi.mock("@/features/evaluation-run/focus/useRunAnnotationSession", () => ({
    useRunAnnotationRefresh: () => fixture.onSaved,
}))
vi.mock("@/features/evaluation-run/focus/useExpectedColumn", () => ({
    useExpectedColumn: () => "correct_answer",
}))
vi.mock("@/features/annotations/useScenarioInvocation", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/features/annotations/useScenarioInvocation")>()),
    useScenarioInvocation: (_runId: string, scenario: unknown) => ({
        pending: Boolean(scenario) && fixture.invocationPending,
        running: false,
        failed: false,
        canRun: true,
        run: fixture.runApp,
    }),
}))

import {FocusView} from "@/features/annotations/FocusView"

import {
    callsOf,
    fakeStore,
    handlers,
    patchSession,
    resetSession,
} from "../support/annotationSessionFake"

const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: Root

const setRun = (run: unknown) =>
    fakeStore.set(
        evaluationRunQueryAtomFamily("") as never,
        {data: run, isSuccess: true, isError: false} as never,
    )
const setStepResults = (results: unknown[]) =>
    fakeStore.set(
        evaluationRunMolecule.selectors.scenarioSteps({runId: "", scenarioId: ""}) as never,
        {data: results, isSuccess: true, isError: false} as never,
    )

const render = async (props: {canEditQueue?: boolean; onOpenConfiguration?: () => void} = {}) => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <FocusView queueId="queue-1" {...props} />
            </Provider>,
        ),
    )
}
const button = (label: string) =>
    Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.startsWith(label) || b.getAttribute("aria-label") === label,
    )
const press = async (target: EventTarget, init: KeyboardEventInit) => {
    await act(async () =>
        target.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, ...init})),
    )
}
const openMenu = async (label: string) => {
    const trigger = button(label)!
    await act(async () => {
        trigger.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
}

beforeEach(() => {
    vi.clearAllMocks()
    fixture.canAnnotate = true
    fixture.wide = true
    fixture.invocationPending = false
    resetSession({
        traceRefs: {
            "s-1": {traceId: "trace-1", spanId: "span-root"},
            "s-2": {traceId: "trace-1", spanId: "span-root"},
        },
        scenarioStatuses: {"s-1": "pending", "s-2": "success"},
        progress: {total: 2, completed: 1, remaining: 1, currentIndex: 0},
        metrics: {"s-1": {tone: {good: {value: null, type: "boolean"}}}},
    })
    setRun(null)
    setStepResults([])
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the queue's Annotate tab", () => {
    it("draws the list, the content and the panel side by side", async () => {
        await render()
        const list = host.querySelector("nav")!
        expect(list.textContent).toContain("1 of 2 completed")
        expect(list.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("1")
        expect(list.textContent).toContain("Needs review1")
        expect(list.textContent).toContain("Completed1")
        // The row reads the trace's first user message.
        expect(list.textContent).toContain("I want to automate my outreach")
        expect(host.querySelector("[aria-current=true]")?.textContent).toContain(
            "I want to automate my outreach",
        )
        expect(host.textContent).toContain("Inputs2 fields")
        expect(host.textContent).toContain("Outreach fix")
        expect(host.textContent).toContain("Conversation2 messages")
        expect(host.textContent).toContain("Annotations")
        expect(host.querySelector("[role=separator]")).not.toBeNull()
    })

    it("A trace whose root span failed reads Error: MESSAGE with Open trace", async () => {
        patchSession({
            traceRefs: {
                "s-1": {traceId: "trace-failed", spanId: "x"},
                "s-2": {traceId: "trace-1", spanId: "span-root"},
            },
        })
        await render()
        expect(host.textContent).toContain("Error: the model provider returned 429")
    })

    it("opens an item from the list", async () => {
        await render()
        const rows = Array.from(host.querySelectorAll("nav button[type=button]")).filter((b) =>
            b.textContent?.includes("trace-1"),
        )
        await act(async () => (rows[1] as HTMLButtonElement).click())
        expect(callsOf("navigateToIndex")).toEqual([1])
    })

    it("folds the list below 1,360px, with Show items and Hide items", async () => {
        fixture.wide = false
        await render()
        expect(host.querySelector("nav")).toBeNull()
        expect(host.textContent).toContain("Item 1 of 2")
        await act(async () => button("Show items")!.click())
        expect(host.querySelector("nav")).not.toBeNull()
        await act(async () => button("Hide items")!.click())
        expect(host.querySelector("nav")).toBeNull()
    })

    it("moves between items from the bar, shows the metrics and opens the trace", async () => {
        patchSession({hasNext: true, hasPrev: false})
        await render()
        expect(button("Previous item")?.disabled).toBe(true)
        await act(async () => button("Next item")!.click())
        expect(callsOf("navigateNext")).toHaveLength(1)
        expect(host.textContent).toContain("61s")
        await act(async () => button("Open trace")!.click())
        expect(fixture.openTrace).toHaveBeenCalledWith({
            traceId: "trace-1",
            activeSpanId: "span-root",
        })
    })

    it("More holds Add to test set, with its reason, and Copy trace ID", async () => {
        patchSession({hasPendingChanges: {"s-1": true}})
        await render()
        await openMenu("More")
        const items = Array.from(document.querySelectorAll("[role=menuitem]"))
        expect(items.map((item) => item.textContent)).toEqual(["Add to test set", "Copy trace ID"])
        expect(items[0].getAttribute("data-disabled")).not.toBeNull()
        expect(document.body.textContent).toContain(
            "Mark this item completed before adding it to a test set.",
        )
        await act(async () => (items[1] as HTMLElement).click())
        expect(fixture.copy).toHaveBeenCalledWith("trace-1")
    })

    it("A test case item has no metrics and no Open trace, and copies the test case ID", async () => {
        patchSession({
            queueKind: "testcases",
            traceRefs: {},
            testcaseRefs: {"s-1": {testcaseId: "tc-1"}},
            testcases: {
                "tc-1": {
                    isPending: false,
                    isError: false,
                    data: {
                        data: {
                            ticket: "We were charged twice",
                            output: '{"category": "billing", "priority": "high"}',
                            expected_output: {category: "billing", priority: "medium"},
                        },
                    },
                },
            },
        })
        await render()
        expect(button("Open trace")).toBeUndefined()
        expect(host.textContent).toContain("JSON, parsed from text")
        expect(host.textContent).toContain("Raw in the copy menu keeps the original string.")
        expect(host.textContent).toContain("1 of 2 fields match")
        await openMenu("More")
        expect(document.body.textContent).toContain("Copy test case ID")
    })

    it("A first completion reads Mark completed and next; a completed item reads Update and its author", async () => {
        patchSession({hasFilledMetrics: {"s-1": true}})
        handlers.submitAnnotations = async () => undefined
        await render()
        await act(async () => button("Mark completed and next")!.click())
        expect(callsOf("submitAnnotations")).toEqual([
            {scenarioId: "s-1", queueId: "queue-1", markComplete: true},
        ])
        expect(fixture.toast.success).toHaveBeenLastCalledWith("Item marked completed")
        expect(fixture.onSaved).toHaveBeenCalled()

        await act(async () =>
            patchSession({
                scenarioStatuses: {"s-1": "success", "s-2": "success"},
                hasPendingChanges: {"s-1": true},
                annotations: {
                    "s-1": [
                        {created_by_id: "user-a", created_at: "2026-11-20T10:00:00Z"},
                        {
                            created_by_id: "user-b",
                            created_at: "2026-11-21T10:00:00Z",
                            updated_at: "2026-11-27T10:00:00Z",
                        },
                    ],
                },
            }),
        )
        expect(host.textContent).toContain("By user-b, 2026-11-27T10:00:00Z")
        await act(async () => button("Update")!.click())
        expect(callsOf("submitAnnotations").at(-1)).toEqual({
            scenarioId: "s-1",
            queueId: "queue-1",
            markComplete: false,
        })
        expect(fixture.toast.success).toHaveBeenLastCalledWith("Updated feedback")
    })

    it("With no filled field the button is off and says why", async () => {
        await render()
        expect(button("Mark completed and next")?.disabled).toBe(true)
        expect(host.textContent).toContain("Fill at least one field to complete this item.")
    })

    it("Every item completed shows the line and Add to test set above the content, and the list stays", async () => {
        patchSession({
            scenarioStatuses: {"s-1": "success", "s-2": "success"},
            progress: {total: 2, completed: 2, remaining: 0, currentIndex: 0},
        })
        await render()
        expect(host.textContent).toContain(
            "All 2 items are completed. You can still open any item and update it.",
        )
        expect(host.querySelector("nav")).not.toBeNull()
        const addButtons = Array.from(host.querySelectorAll("button")).filter((b) =>
            b.textContent?.includes("Add to test set"),
        )
        await act(async () => addButtons[0].click())
        expect(callsOf("openAddToTestsetModal")).toEqual([{scope: "complete"}])
    })

    it("A reader without edit_annotations sees the values read only, no button and no keys", async () => {
        fixture.canAnnotate = false
        await render()
        expect(host.textContent).toContain("You can view this queue. You cannot annotate it.")
        expect(button("Mark completed and next")).toBeUndefined()
        expect(host.querySelector("[data-annotation-field]")).toBeNull()
        await press(document.body, {key: "1"})
        expect(callsOf("updateMetric")).toHaveLength(0)
    })

    it("No evaluators offers Open Configuration to a reader who can edit the queue", async () => {
        patchSession({evaluatorStepRefs: []})
        const onOpenConfiguration = vi.fn()
        await render({canEditQueue: true, onOpenConfiguration})
        expect(host.textContent).toContain("No evaluators configured for this queue")
        await act(async () => button("Open Configuration")!.click())
        expect(onOpenConfiguration).toHaveBeenCalled()
    })

    describe("a run's item", () => {
        beforeEach(() => {
            setRun({
                data: {
                    steps: [
                        {key: "input", type: "input", references: {testset: {id: "ts-1"}}},
                        {key: "app", type: "invocation", origin: "human"},
                        {key: "judge", type: "annotation", origin: "human"},
                    ],
                },
            })
            patchSession({
                queueKind: "testsets",
                traceRefs: {},
                testcaseRefs: {"s-1": {testcaseId: "tc-1"}},
                testcases: {
                    "tc-1": {
                        isPending: false,
                        isError: false,
                        data: {data: {country: "France", correct_answer: "Paris"}},
                    },
                },
            })
        })

        it("with no output shows Run in place of the form, and Cmd Enter runs the app", async () => {
            fixture.invocationPending = true
            await render()
            expect(host.textContent).toContain("Generate output to annotate")
            expect(button("Mark completed and next")).toBeUndefined()
            await press(document.body, {key: "Enter", metaKey: true})
            expect(fixture.runApp).toHaveBeenCalledTimes(1)
        })

        const setResultsState = (state: {isSuccess: boolean; isError: boolean}) => {
            const refetch = vi.fn()
            fakeStore.set(
                evaluationRunMolecule.selectors.scenarioSteps({runId: "", scenarioId: ""}) as never,
                {data: undefined, ...state, refetch} as never,
            )
            return refetch
        }

        it("while the step results load, offers neither Run nor the form", async () => {
            fixture.invocationPending = true
            setResultsState({isSuccess: false, isError: false})
            await render()
            expect(host.textContent).not.toContain("Generate output to annotate")
            expect(button("Mark completed and next")).toBeUndefined()
            expect(host.querySelectorAll("[role=status]").length).toBeGreaterThan(0)
            await press(document.body, {key: "Enter", metaKey: true})
            expect(fixture.runApp).not.toHaveBeenCalled()
        })

        it("a failed run read is a failed load with Retry, not a plain test case", async () => {
            const refetch = vi.fn()
            patchSession({activeRunId: "run-1"})
            fakeStore.set(
                evaluationRunQueryAtomFamily("") as never,
                {data: undefined, isSuccess: false, isError: true, refetch} as never,
            )
            await render()
            expect(host.textContent).toContain("Could not load this item")
            expect(button("Mark completed and next")).toBeUndefined()
            await act(async () => button("Retry")!.click())
            expect(refetch).toHaveBeenCalled()
        })

        it("a failed trace read of a finished app call offers Retry", async () => {
            setStepResults([{step_key: "app", status: "success", trace_id: "trace-missing"}])
            await render()
            expect(host.textContent).toContain("Failed to load trace data")
            expect(button("Retry")).toBeDefined()
        })

        it("when the step results fail, says so and Retry reads them again", async () => {
            fixture.invocationPending = true
            const refetch = setResultsState({isSuccess: false, isError: true})
            await render()
            expect(host.textContent).not.toContain("Generate output to annotate")
            expect(host.textContent).toContain("Could not load this item")
            await act(async () => button("Retry")!.click())
            expect(refetch).toHaveBeenCalled()
            await press(document.body, {key: "Enter", metaKey: true})
            expect(fixture.runApp).not.toHaveBeenCalled()
        })

        it("with a failed app call reads Error: MESSAGE with Open trace", async () => {
            setStepResults([
                {
                    step_key: "app",
                    status: "failure",
                    trace_id: "trace-1",
                    error: {message: "the model provider returned 429, rate limit reached."},
                },
            ])
            await render()
            expect(host.textContent).toContain(
                "Error: the model provider returned 429, rate limit reached.",
            )
            const openTrace = Array.from(host.querySelectorAll("[role=alert] button"))[0]
            await act(async () => (openTrace as HTMLButtonElement).click())
            expect(fixture.openTrace).toHaveBeenCalledWith({
                traceId: "trace-1",
                activeSpanId: "span-root",
            })
            expect(host.textContent).toContain("France")
        })
    })
})
