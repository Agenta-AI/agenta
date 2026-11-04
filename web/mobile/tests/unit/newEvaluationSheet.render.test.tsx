// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {NewEvaluationKind} from "@/features/evaluations/new/newEvaluationDraft"
import {NewEvaluationSheet} from "@/features/evaluations/new/NewEvaluationSheet"

import {pickers, resetWizardData, wizardData} from "../support/newEvaluationMocks"

const hook = vi.hoisted(() => ({
    start: vi.fn(),
    isStarting: false,
}))

vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    ...(await import("../support/newEvaluationMocks")).workflowOverrides,
}))
vi.mock(
    "@agenta/entity-ui/selection",
    async () => (await import("../support/newEvaluationMocks")).selectionMock,
)
vi.mock("@/features/evaluations/new/useStartEvaluation", () => ({
    useStartEvaluation: () => ({start: hook.start, isStarting: hook.isStarting}),
}))
vi.mock("@/features/developer/developerViewAccess", () => ({useDeveloperViewEnabled: () => false}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const onClose = vi.fn()
const onStarted = vi.fn()

const mount = async (kind: NewEvaluationKind | null, appId: string | null = null) => {
    await act(async () =>
        root.render(
            <Provider store={createStore()}>
                <NewEvaluationSheet
                    kind={kind}
                    projectId="pr"
                    base="/w/ws/p/pr"
                    appId={appId}
                    onClose={onClose}
                    onStarted={onStarted}
                />
            </Provider>,
        ),
    )
}

const dialog = () => document.querySelector<HTMLElement>("[role=dialog]")
const text = () => dialog()?.textContent ?? ""
const openSection = () =>
    document.querySelector("[data-slot=accordion-trigger][data-state=open]")?.textContent

const pick = async (instanceId: string, result: unknown) => {
    await act(async () => (pickers.latest[instanceId].onSelect as (r: unknown) => void)(result))
}

const openByClick = async (title: string) =>
    act(async () => {
        const trigger = [
            ...document.querySelectorAll<HTMLElement>("[data-slot=accordion-trigger]"),
        ].find((el) => el.textContent?.startsWith(title))
        trigger?.click()
    })

const buttonByName = (name: string | RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? ""),
    )

beforeEach(() => {
    vi.clearAllMocks()
    resetWizardData()
    hook.isStarting = false
    hook.start.mockResolvedValue({status: "started", kind: "auto"})
    wizardData.apps = [
        {id: "app-1", name: "Support bot"},
        {id: "app-2", name: "Search bot"},
    ]
    wizardData.evaluatorCount = 1
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("new evaluation sheet", () => {
    it("The title reads New Human Evaluation for a human start", async () => {
        await mount("human")
        expect(text()).toContain("New Human Evaluation")
        expect(text()).not.toContain("Advanced Settings")
    })

    it("The title reads New Auto Evaluation and shows Advanced Settings for an auto start", async () => {
        await mount("auto")
        expect(text()).toContain("New Auto Evaluation")
        expect(text()).toContain("Advanced Settings")
        expect(openSection()).toContain("Application")
    })

    it("The sheet stays closed without a kind", async () => {
        await mount(null)
        expect(dialog()).toBeNull()
    })

    it("Opened in app scope, the sheet starts on Revision and the app chip cannot be removed", async () => {
        await mount("auto", "app-1")
        expect(openSection()).toContain("Revision")
        expect(text()).toContain("Support bot")
        expect(buttonByName("Remove Support bot")).toBeUndefined()
        expect(
            (pickers.latest["new-evaluation-revision-app-1"].adapter as {options: unknown}).options,
        ).toMatchObject({workflowId: "app-1"})
    })

    it("Close and Escape do nothing while starting", async () => {
        hook.isStarting = true
        await mount("auto")

        await act(async () => {
            dialog()?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })
        expect(dialog()).not.toBeNull()
        expect(onClose).not.toHaveBeenCalled()
        expect(buttonByName(/^close$/i)).toBeUndefined()
        expect(buttonByName("Cancel")?.disabled).toBe(true)
    })

    it("The app list cannot change while a start runs", async () => {
        hook.isStarting = true
        await mount("auto")
        const rows = [
            ...document.querySelectorAll<HTMLButtonElement>("ul[aria-label=Applications] button"),
        ]
        expect(rows.length).toBe(2)
        expect(rows.every((row) => row.disabled)).toBe(true)
    })

    it("A scoped app starts the draft before the app list loads", async () => {
        wizardData.apps = []
        wizardData.appsPending = true
        await mount("auto", "app-1")
        expect(openSection()).toContain("Revision")
        expect(pickers.latest["new-evaluation-revision-app-1"]).toBeDefined()
    })

    it("Cancel closes the sheet", async () => {
        await mount("auto")
        await act(async () => buttonByName("Cancel")?.click())
        expect(onClose).toHaveBeenCalled()
    })

    it("Section headers show a check and chips for each pick", async () => {
        await mount("auto", "app-1")
        await pick("new-evaluation-revision-app-1", {
            id: "rev-a",
            metadata: {variantName: "default", revision: 3},
        })
        await openByClick("Test set")
        await pick("new-evaluation-testset", {
            id: "ts-rev",
            metadata: {testsetId: "ts", testsetName: "greetings", revisionId: "ts-rev", version: 2},
        })

        const chips = [...document.querySelectorAll("li")].map((li) => li.textContent)
        expect(chips).toEqual(
            expect.arrayContaining([
                "Support bot",
                "default - v3",
                "greetings - v2",
                "batch_size: 10",
                "max_retries: 3",
                "retry_delay: 3",
            ]),
        )
        expect(document.querySelector("[aria-label='Revision complete']")).not.toBeNull()
        expect(document.querySelector("[aria-label='Test set complete']")).not.toBeNull()
        expect(document.querySelector("[aria-label='Evaluators complete']")).toBeNull()
        // A test set pick opens the Evaluators section.
        expect(openSection()).toContain("Evaluators")
    })

    it("Advanced Settings shows its check with the default settings", async () => {
        await mount("auto", "app-1")
        expect(document.querySelector("[aria-label='Advanced Settings complete']")).not.toBeNull()
    })

    it("The auto name follows the picks", async () => {
        await mount("auto", "app-1")
        await pick("new-evaluation-revision-app-1", {
            id: "rev-a",
            metadata: {variantName: "default", revision: 3},
        })
        await openByClick("Test set")
        await pick("new-evaluation-testset", {
            id: "ts-rev",
            metadata: {testsetId: "ts", testsetName: "greetings", revisionId: "ts-rev", version: 2},
        })
        const name = document.querySelector<HTMLInputElement>("input[placeholder='Enter a name']")
        expect(name?.value).toMatch(/^default-v3-greetings-[a-z0-9]{5}$/)
    })

    it("An invalid start opens the failing section and keeps the sheet open", async () => {
        hook.start.mockResolvedValue({status: "invalid", section: "evaluators"})
        await mount("auto", "app-1")

        await act(async () => buttonByName("Start Evaluation")?.click())

        expect(openSection()).toContain("Evaluators")
        expect(onClose).not.toHaveBeenCalled()
        expect(onStarted).not.toHaveBeenCalled()
    })

    it("A failed start keeps the picks and the sheet", async () => {
        hook.start.mockResolvedValue({status: "failed"})
        await mount("auto", "app-1")
        await pick("new-evaluation-revision-app-1", {
            id: "rev-a",
            metadata: {variantName: "default", revision: 3},
        })

        await act(async () => buttonByName("Start Evaluation")?.click())

        expect(onClose).not.toHaveBeenCalled()
        expect(text()).toContain("default - v3")
    })

    it("A started evaluation closes the sheet and reports its kind", async () => {
        await mount("auto", "app-1")
        await act(async () => buttonByName("Start Evaluation")?.click())
        expect(onStarted).toHaveBeenCalledWith("auto")
        expect(onClose).toHaveBeenCalled()
    })
})
