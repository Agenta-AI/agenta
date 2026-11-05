// @vitest-environment jsdom
/**
 * The focus view: what it shows for a trace and a test case, the footer's buttons, the keyboard
 * keys, the save messages, and the all-caught-up state. The controllers are the shared fake and
 * the trace overview is a stub, so no request is sent.
 */
import {act} from "react"

import {Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    toast: {success: vi.fn(), error: vi.fn()},
    openTrace: vi.fn(),
}))

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
        annotationFormController: fake.annotationFormController,
    }
})
vi.mock("@agenta/entities/trace", async () => {
    const {atom} = await import("jotai")
    const loaded = atom({isPending: false, isError: false, data: {}})
    const span = atom({span_id: "span-root", span_name: "answer_question"})
    return {traceEntityAtomFamily: () => loaded, traceRootSpanAtomFamily: () => span}
})
vi.mock("@agenta/observability-ui/traceDrawer", () => ({
    OverviewTabItem: ({activeTrace}: {activeTrace: {span_name: string}}) => (
        <div>{`overview of ${activeTrace.span_name}`}</div>
    ),
}))
vi.mock("@agenta/observability/traceDrawer", async () => {
    const {atom} = await import("jotai")
    return {openTraceDrawerAtom: atom(null, (_get, _set, payload) => fixture.openTrace(payload))}
})
vi.mock("@agenta/ui/app-message", () => ({message: fixture.toast}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))

import {FocusView} from "@/features/annotations/FocusView"

import {
    calls,
    callsOf,
    fakeStore,
    handlers,
    patchSession,
    resetSession,
} from "../support/annotationSessionFake"

// Radix measures the slider thumb; jsdom has no ResizeObserver.
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

let host: HTMLDivElement
let root: Root

const render = async () => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <FocusView queueId="queue-1" observabilityHref="/w/ws-1/p/proj-1/observability" />
            </Provider>,
        ),
    )
}
const button = (label: string) =>
    Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent?.startsWith(label) || b.getAttribute("aria-label") === label,
    )
const press = async (target: EventTarget, init: KeyboardEventInit) => {
    await act(async () =>
        target.dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, ...init})),
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    resetSession({
        traceRefs: {"s-1": {traceId: "trace-1", spanId: "span-root"}},
        metrics: {"s-1": {tone: {comment: {value: null, type: "string"}}}},
    })
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the focus view", () => {
    it("A trace queue renders the trace overview of the root span", async () => {
        await render()
        expect(host.textContent).toContain("overview of answer_question")
        await act(async () => button("Open trace")!.click())
        expect(fixture.openTrace).toHaveBeenCalledWith({
            traceId: "trace-1",
            activeSpanId: "span-root",
        })
    })

    it("A test case queue splits fields into inputs, expected outputs and outputs", async () => {
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
                            output: "Paris",
                            question: "Capital of France?",
                            expected_output: "Paris",
                            testcase_dedup_id: "hidden",
                        },
                    },
                },
            },
        })
        await render()
        const groups = Array.from(host.querySelectorAll("[data-group]")).map((group) => [
            group.getAttribute("data-group"),
            Array.from(group.querySelectorAll("h3")).map((h) => h.textContent),
        ])
        expect(groups).toEqual([
            ["inputs", ["question"]],
            ["expected", ["expected_output"]],
            ["outputs", ["output"]],
        ])
        expect(host.textContent).not.toContain("testcase_dedup_id")
    })

    it("A test set queue shows the test case, not a missing trace", async () => {
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
        await render()
        expect(host.textContent).not.toContain("Trace reference is not available yet")
        const fields = Array.from(host.querySelectorAll("[data-group] h3")).map(
            (h) => h.textContent,
        )
        expect(fields).toEqual(["country", "correct_answer"])
        expect(button("Open trace")).toBeUndefined()
    })

    it("Next is disabled on the last scenario", async () => {
        patchSession({hasNext: false, hasPrev: true})
        await render()
        expect(button("Next")?.disabled).toBe(true)
        expect(button("Prev")?.disabled).toBe(false)
        await act(async () => button("Prev")!.click())
        expect(callsOf("navigatePrev")).toHaveLength(1)
    })

    it("Arrow keys move between scenarios outside of inputs only", async () => {
        await render()
        await press(document.body, {key: "ArrowRight"})
        expect(callsOf("navigateNext")).toHaveLength(1)

        const textarea = host.querySelector("textarea")!
        await press(textarea, {key: "ArrowRight"})
        expect(callsOf("navigateNext")).toHaveLength(1)

        // No previous item: the left arrow does nothing.
        await press(document.body, {key: "ArrowLeft"})
        expect(callsOf("navigatePrev")).toHaveLength(0)

        // True and False use the arrows themselves.
        await act(async () =>
            patchSession({
                metrics: {"s-1": {tone: {friendly: {value: null, type: "boolean"}}}},
            }),
        )
        await press(host.querySelector("[role=radio]")!, {key: "ArrowRight"})
        expect(callsOf("navigateNext")).toHaveLength(1)
    })

    it("Ctrl Enter submits from inside a text field", async () => {
        patchSession({hasFilledMetrics: {"s-1": true}})
        handlers.submitAnnotations = async () => undefined
        await render()
        const textarea = host.querySelector("textarea")!
        await press(textarea, {key: "Enter", ctrlKey: true})
        expect(callsOf("submitAnnotations")).toEqual([
            {scenarioId: "s-1", queueId: "queue-1", markComplete: true},
        ])
    })

    describe("a number out of its range", () => {
        // The fake controller keeps no values: it records the writes, so the order is the proof.
        const typeNine = async () => {
            patchSession({
                hasFilledMetrics: {"s-1": true},
                metrics: {
                    "s-1": {tone: {score: {value: null, type: "integer", minimum: 1, maximum: 5}}},
                },
            })
            handlers.submitAnnotations = async () => undefined
            await render()
            const input = host.querySelector("input[role=spinbutton]") as HTMLInputElement
            input.focus()
            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
            )!.set!
            await act(async () => {
                setter.call(input, "9")
                input.dispatchEvent(new Event("input", {bubbles: true}))
            })
            return input
        }
        const names = () => calls.map(([name]) => name).filter((n) => /updateMetric|submit/.test(n))
        const lastValue = () => (callsOf("updateMetric").at(-1) as {value: number}).value

        it("Ctrl Enter sends the value clamped to the maximum", async () => {
            const input = await typeNine()
            await press(input, {key: "Enter", ctrlKey: true})
            expect(lastValue()).toBe(5)
            expect(names().at(-1)).toBe("submitAnnotations")
        })

        it("The button sends the value clamped to the maximum", async () => {
            await typeNine()
            const submit = button("Mark completed")!
            await act(async () => submit.focus())
            await act(async () => submit.click())
            expect(lastValue()).toBe(5)
            expect(names().at(-1)).toBe("submitAnnotations")
        })
    })

    it("A first completion shows Scenario completed and a second save shows Updated feedback", async () => {
        patchSession({hasFilledMetrics: {"s-1": true}})
        handlers.submitAnnotations = async () => undefined
        await render()
        await act(async () => button("Mark completed")!.click())
        expect(fixture.toast.success).toHaveBeenLastCalledWith("Scenario completed")

        await act(async () =>
            patchSession({
                scenarioStatuses: {"s-1": "success", "s-2": "pending"},
                hasPendingChanges: {"s-1": true},
            }),
        )
        await act(async () => button("Update")!.click())
        expect(callsOf("submitAnnotations").at(-1)).toEqual({
            scenarioId: "s-1",
            queueId: "queue-1",
            markComplete: false,
        })
        expect(fixture.toast.success).toHaveBeenLastCalledWith("Updated feedback")
    })

    it("A failed submit shows Couldn't save the annotations without the API text", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
        patchSession({hasFilledMetrics: {"s-1": true}})
        handlers.submitAnnotations = async () => {
            throw new Error("Request failed with status code 403")
        }
        await render()
        await act(async () => button("Mark completed")!.click())
        expect(fixture.toast.error).toHaveBeenCalledWith("Couldn't save the annotations")
        expect(JSON.stringify(fixture.toast.error.mock.calls)).not.toContain("403")
        expect(consoleError).toHaveBeenCalled()
        consoleError.mockRestore()
    })

    it("Add to Testset explains why it is off while a new annotation is unsaved", async () => {
        patchSession({hasPendingChanges: {"s-1": true}})
        await render()
        expect(button("Add to Testset")?.disabled).toBe(true)
        await act(async () => patchSession({hasPendingChanges: {}}))
        await act(async () => button("Add to Testset")!.click())
        expect(callsOf("openAddToTestsetModal")).toEqual([{scope: "single", scenarioIds: ["s-1"]}])
    })

    it("All caught up hides Go to observability for a test case queue", async () => {
        patchSession({
            queueKind: "testcases",
            progress: {total: 2, completed: 2, remaining: 0, currentIndex: 0},
        })
        await render()
        expect(host.textContent).toContain("You're all caught up")
        expect(host.textContent).toContain("Add more from Test Sets.")
        expect(host.textContent).not.toContain("Go to observability")
        await act(async () => button("Add to Testset")!.click())
        expect(callsOf("openAddToTestsetModal")).toEqual([{scope: "complete"}])

        await act(async () => patchSession({queueKind: "traces"}))
        expect(host.textContent).toContain("Go to observability")
    })

    it("Every item hidden by the switches asks to adjust them", async () => {
        patchSession({focusScenarioIds: [], currentScenarioId: null})
        await render()
        expect(host.textContent).toContain("No scenarios available")
        expect(host.textContent).toContain("Adjust the focus switches to continue annotating.")
    })
})
