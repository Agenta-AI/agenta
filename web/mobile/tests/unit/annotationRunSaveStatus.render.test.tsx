// @vitest-environment jsdom
/**
 * A save in a run marks the test case complete only in a human run. In an automatic run the test
 * case status is the app call's result, so a save on a failed or pending test case keeps it.
 */
import {act} from "react"

import {atom, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@agenta/annotation", async (importOriginal) => {
    const fake = await import("../support/annotationSessionFake")
    return {
        ...(await importOriginal<typeof import("@agenta/annotation")>()),
        annotationSessionController: fake.annotationSessionController,
        annotationFormController: fake.annotationFormController,
    }
})
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))

const header = vi.hoisted(() => ({atom: null as unknown}))
vi.mock("@agenta/entities/evaluationRun", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/entities/evaluationRun")>()),
    runHeaderAtomFamily: () => header.atom,
}))

import {callsOf, fakeStore, handlers, resetSession} from "../support/annotationSessionFake"

import {useSubmitAnnotations} from "@/features/annotations/useSubmitAnnotations"

const runHeader = atom({kind: "auto"})
header.atom = runHeader
const setKind = (kind: string) => fakeStore.set(runHeader as PrimitiveAtom<{kind: string}>, {kind})

let save: () => Promise<void> = async () => undefined
const RunSave = () => {
    save = useSubmitAnnotations("s-1", {runId: "run-1"}).submit
    return null
}

let host: HTMLDivElement
let root: Root
const render = async () => {
    await act(async () =>
        root.render(
            <Provider store={fakeStore}>
                <RunSave />
            </Provider>,
        ),
    )
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("A save in a run", () => {
    it("keeps the status of a failed test case in an automatic run", async () => {
        setKind("auto")
        resetSession({scenarioStatuses: {"s-1": "failure"}})
        handlers.submitAnnotations = async () => undefined
        await render()
        await act(async () => save())
        expect(callsOf("submitAnnotations")).toEqual([{scenarioId: "s-1", markComplete: false}])
    })

    it("keeps the status of a pending test case in an SDK run", async () => {
        setKind("custom")
        resetSession({scenarioStatuses: {"s-1": "pending"}})
        handlers.submitAnnotations = async () => undefined
        await render()
        await act(async () => save())
        expect(callsOf("submitAnnotations")).toEqual([{scenarioId: "s-1", markComplete: false}])
    })

    it("marks the test case complete in a human run", async () => {
        setKind("human")
        resetSession({scenarioStatuses: {"s-1": "pending"}})
        handlers.submitAnnotations = async () => undefined
        await render()
        await act(async () => save())
        expect(callsOf("submitAnnotations")).toEqual([{scenarioId: "s-1", markComplete: true}])
    })
})
