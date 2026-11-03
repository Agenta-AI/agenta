// @vitest-environment jsdom
/**
 * The annotation form panel: its states, its alerts, and when its Mark completed button may save.
 * The controllers are the shared fake, so no request is sent.
 */
import {act} from "react"

import {Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const toast = vi.hoisted(() => ({success: vi.fn(), error: vi.fn()}))

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
        annotationFormController: fake.annotationFormController,
    }
})
vi.mock("@agenta/ui/app-message", () => ({message: toast}))

import {AnnotationFormPanel} from "@/features/annotations/AnnotationFormPanel"

import {
    callsOf,
    fakeStore,
    handlers,
    patchSession,
    resetSession,
} from "../support/annotationSessionFake"

let host: HTMLDivElement
let root: Root

const TONE_FIELDS = {tone: {friendly: {value: null, type: "boolean"}}}

const render = async (showSubmit = false) => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <AnnotationFormPanel scenarioId="s-1" queueId="queue-1" showSubmit={showSubmit} />
            </Provider>,
        ),
    )
}
const button = (label: string) =>
    Array.from(host.querySelectorAll("button")).find(
        (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    )

beforeEach(() => {
    vi.clearAllMocks()
    resetSession({metrics: {"s-1": TONE_FIELDS}})
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("the annotation form panel", () => {
    it("A completed scenario shows Completed", async () => {
        await render()
        expect(host.textContent).toContain("Incomplete")
        await act(async () => patchSession({scenarioStatuses: {"s-1": "success"}}))
        expect(host.textContent).toContain("Completed")
        expect(host.textContent).not.toContain("Incomplete")
    })

    it("No evaluator refs shows No evaluators configured for this queue", async () => {
        patchSession({evaluatorStepRefs: []})
        await render()
        expect(host.textContent).toContain("No evaluators configured for this queue")
    })

    it("Evaluators that fail to resolve show Could not load evaluator schemas for this queue", async () => {
        patchSession({evaluators: [], evaluatorResolution: {isPending: true, hasError: false}})
        await render()
        expect(host.textContent).toContain("Loading evaluators...")
        await act(async () =>
            patchSession({evaluatorResolution: {isPending: false, hasError: true}}),
        )
        expect(host.textContent).toContain("Could not load evaluator schemas for this queue")
    })

    it("A partial evaluator failure shows the warning and the loaded fields", async () => {
        patchSession({evaluatorResolution: {isPending: false, hasError: true}})
        await render()
        expect(host.textContent).toContain(
            "Some evaluators could not be loaded. Loaded evaluator fields are still available.",
        )
        expect(host.textContent).toContain("Tone")
        expect(host.textContent).toContain("friendly")
        await act(async () => button("True")!.click())
        expect(callsOf("updateMetric")).toEqual([
            {scenarioId: "s-1", slug: "tone", fieldKey: "friendly", value: true},
        ])
    })

    it("A submit error shows Couldn't save the annotations and can be closed", async () => {
        patchSession({submitError: {"s-1": "Request failed with status code 500"}})
        await render()
        expect(host.textContent).toContain("Couldn't save the annotations")
        expect(host.textContent).not.toContain("status code 500")
        await act(async () => button("Close")!.click())
        expect(callsOf("clearSubmitError")).toEqual(["s-1"])
    })

    it("Mark completed is disabled until a metric is filled", async () => {
        await render(true)
        expect(button("Mark completed")?.disabled).toBe(true)
        await act(async () => patchSession({hasFilledMetrics: {"s-1": true}}))
        expect(button("Mark completed")?.disabled).toBe(false)

        handlers.submitAnnotations = async () => undefined
        await act(async () => button("Mark completed")!.click())
        expect(callsOf("submitAnnotations")).toEqual([
            {scenarioId: "s-1", queueId: "queue-1", markComplete: true},
        ])
        expect(toast.success).toHaveBeenCalledWith("Scenario completed")
    })

    it("Update is disabled until a value changes", async () => {
        patchSession({scenarioStatuses: {"s-1": "success"}, hasFilledMetrics: {"s-1": true}})
        await render(true)
        expect(button("Update")?.disabled).toBe(true)
        await act(async () => patchSession({hasPendingChanges: {"s-1": true}}))
        expect(button("Update")?.disabled).toBe(false)
    })
})
