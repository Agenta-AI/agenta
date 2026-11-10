// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {DraftRevision, NewEvaluationKind} from "@/features/evaluations/new/newEvaluationDraft"
import {NewEvaluationSheet} from "@/features/evaluations/new/NewEvaluationSheet"

import {
    autoEvaluator,
    resetWizardData,
    revisionRow,
    wizardData,
} from "../support/newEvaluationMocks"
import {stubResizeObserver} from "../support/playgroundHarness"

const hook = vi.hoisted(() => ({
    start: vi.fn(),
    isStarting: false,
    members: [] as {user: {id: string; username: string; email: string}}[],
}))

vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    ...(await import("../support/newEvaluationMocks")).workflowOverrides,
}))
vi.mock(
    "@/features/variants/useAppRevisions",
    async () => (await import("../support/newEvaluationMocks")).appRevisionsMock,
)
vi.mock(
    "@/features/testsets/list/useTestsetsList",
    async () => (await import("../support/newEvaluationMocks")).testsetsListMock,
)
vi.mock(
    "@/features/evaluations/new/useTestsetLatestRevisions",
    async () => (await import("../support/newEvaluationMocks")).testsetRevisionsMock,
)
vi.mock(
    "@/features/evaluators/useEvaluators",
    async () => (await import("../support/newEvaluationMocks")).evaluatorsMock,
)
vi.mock(
    "@/features/evaluators/useEvaluatorRevisions",
    async () => (await import("../support/newEvaluationMocks")).evaluatorRevisionsMock,
)
vi.mock(
    "@agenta/entity-ui/variant",
    async () => (await import("../support/newEvaluationMocks")).variantUiMock,
)
vi.mock(
    "@agenta/entity-ui/workflow",
    async () => (await import("../support/newEvaluationMocks")).workflowUiMock,
)
vi.mock("@/features/evaluations/new/useStartEvaluation", () => ({
    useStartEvaluation: () => ({start: hook.start, isStarting: hook.isStarting}),
}))
vi.mock("@/features/developer/developerViewAccess", () => ({useDeveloperViewEnabled: () => false}))
vi.mock("next/router", () => ({useRouter: () => ({query: {workspace_id: "ws"}})}))
vi.mock("@/features/settings/useSettingsOrg", () => ({
    useSettingsOrg: () => ({org: {data: {default_workspace: {members: hook.members}}}}),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const onClose = vi.fn()
const onStarted = vi.fn()

const mount = async (
    kind: NewEvaluationKind | null,
    appId: string | null = null,
    initialRevisions?: DraftRevision[],
) => {
    await act(async () =>
        root.render(
            <Provider store={createStore()}>
                <NewEvaluationSheet
                    kind={kind}
                    projectId="pr"
                    base="/w/ws/p/pr"
                    appId={appId}
                    initialRevisions={initialRevisions}
                    onClose={onClose}
                    onStarted={onStarted}
                />
            </Provider>,
        ),
    )
}

const dialog = () => document.querySelector<HTMLElement>("[role=dialog]")
const confirmDialog = () => document.querySelector<HTMLElement>("[role=alertdialog]")
const text = () => dialog()?.textContent ?? ""
const activeStep = () =>
    document.querySelector("nav[aria-label=Steps] [aria-current=step]")?.textContent
const openStep = async (title: string) =>
    act(async () => {
        const step = [
            ...document.querySelectorAll<HTMLButtonElement>("nav[aria-label=Steps] button"),
        ].find((button) => button.textContent === title)
        step?.click()
    })
const chips = (title: string) =>
    [...document.querySelectorAll(`[aria-label="${title} picks"] > li`)].map(
        (chip) => chip.textContent,
    )
const rowByText = (label: string) =>
    [...document.querySelectorAll<HTMLElement>("[role=dialog] div.grid")]
        .filter((row) => row.getAttribute("role") !== "row")
        .find((row) => row.textContent?.includes(label))
const clickRow = async (label: string) => act(async () => rowByText(label)?.click())
const buttonByName = (name: string, scope: ParentNode = document) =>
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)
const pressEscape = async () =>
    act(async () => {
        document.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Escape", bubbles: true}),
        )
    })

beforeEach(() => {
    vi.clearAllMocks()
    // The pick controls inside the form measure themselves.
    stubResizeObserver()
    resetWizardData()
    hook.isStarting = false
    hook.members = []
    hook.start.mockResolvedValue({status: "started", kind: "auto"})
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    wizardData.apps = [
        {id: "app-1", name: "Support bot"},
        {id: "app-2", name: "Search bot"},
    ]
    wizardData.revisions = [revisionRow("rev-a", "default", 3)]
    wizardData.testsets = [{id: "ts", name: "greetings", created_at: null, created_by_id: "user-1"}]
    wizardData.testsetRevisions = {ts: {id: "ts-rev", version: 2, message: null}}
    wizardData.evaluators.automatic = [autoEvaluator("ev-exact", "Exact Match")]
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

    it("The sheet shows the step list with the Application table open", async () => {
        await mount("auto")
        expect(text()).toContain("New Auto Evaluation")
        const steps = [...document.querySelectorAll("nav[aria-label=Steps] button")].map(
            (step) => step.textContent,
        )
        expect(steps).toEqual([
            "Application",
            "Revision",
            "Test set",
            "Evaluators",
            "Advanced Settings",
        ])
        expect(activeStep()).toBe("Application")
        expect(rowByText("Support bot")).toBeDefined()
    })

    it("The sheet stays closed without a kind", async () => {
        await mount(null)
        expect(dialog()).toBeNull()
    })

    it("Opened in app scope, the sheet starts on Revision and the app chip cannot be removed", async () => {
        await mount("auto", "app-1")
        expect(activeStep()).toBe("Revision")
        expect(chips("Application")).toEqual(["Support bot"])
        expect(document.querySelector("[aria-label='Remove Support bot']")).toBeNull()
        expect(rowByText("default v3")).toBeDefined()
    })

    it("Close and Escape do nothing while starting", async () => {
        hook.isStarting = true
        await mount("auto")
        await pressEscape()
        expect(dialog()).not.toBeNull()
        expect(onClose).not.toHaveBeenCalled()
        expect(document.querySelector("[aria-label=Close]")).toBeNull()
        expect(buttonByName("Cancel")?.disabled).toBe(true)
    })

    it("An untouched draft closes at once on Cancel and on Escape", async () => {
        await mount("auto")
        await act(async () => buttonByName("Cancel")?.click())
        expect(confirmDialog()).toBeNull()
        expect(onClose).toHaveBeenCalledTimes(1)

        await pressEscape()
        expect(confirmDialog()).toBeNull()
        expect(onClose).toHaveBeenCalledTimes(2)
    })

    it("Escape on a draft with picks asks first, and Cancel in the question keeps the draft", async () => {
        await mount("auto")
        await clickRow("Support bot")
        await pressEscape()

        expect(confirmDialog()?.textContent).toContain("Discard this evaluation?")
        expect(onClose).not.toHaveBeenCalled()
        await act(async () => buttonByName("Cancel", confirmDialog()!)?.click())
        expect(onClose).not.toHaveBeenCalled()
        expect(chips("Application")).toEqual(["Support bot"])
    })

    it("Discard in the question closes the sheet", async () => {
        await mount("auto")
        await clickRow("Support bot")
        await act(async () => buttonByName("Cancel")?.click())
        await act(async () => buttonByName("Discard", confirmDialog()!)?.click())
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("A typed name alone also asks before closing", async () => {
        await mount("auto")
        const input = document.querySelector<HTMLInputElement>("input[placeholder='Enter a name']")!
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, "my run")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        await act(async () => buttonByName("Cancel")?.click())
        expect(confirmDialog()).not.toBeNull()
        expect(onClose).not.toHaveBeenCalled()
    })

    it("From the playground, the revisions start the draft, the test set table shows inline, and Escape closes at once", async () => {
        await mount("auto", "app-1", [{id: "rev-a", variantName: "default", version: 3}])
        expect(activeStep()).toBe("Test set")
        expect(chips("Revision")).toEqual(["default - v3"])
        expect(rowByText("greetings")).toBeDefined()

        await pressEscape()
        expect(confirmDialog()).toBeNull()
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("The test set table names its author, not the user id", async () => {
        hook.members = [{user: {id: "user-1", username: "Sam Lee", email: "sam@example.com"}}]
        await mount("auto", "app-1", [{id: "rev-a", variantName: "default", version: 3}])
        const row = rowByText("greetings")?.textContent ?? ""
        expect(row).toContain("Sam Lee")
        expect(row).not.toContain("user-1")
    })

    it("Steps show a check and chips for each pick, and a test set pick opens Evaluators", async () => {
        await mount("auto", "app-1")
        await clickRow("default v3")
        await openStep("Test set")
        await clickRow("greetings")

        expect(chips("Application")).toEqual(["Support bot"])
        expect(chips("Revision")).toEqual(["default - v3"])
        expect(chips("Test set")).toEqual(["greetings - v2"])
        expect(chips("Advanced Settings")).toEqual([
            "batch_size: 10",
            "max_retries: 3",
            "retry_delay: 3",
        ])
        expect(document.querySelector("[aria-label='Revision complete']")).not.toBeNull()
        expect(document.querySelector("[aria-label='Test set complete']")).not.toBeNull()
        expect(document.querySelector("[aria-label='Evaluators complete']")).toBeNull()
        expect(activeStep()).toBe("Evaluators")
        expect(rowByText("Exact Match")).toBeDefined()
    })

    it("A chip's remove button drops that pick", async () => {
        await mount("auto", "app-1")
        await clickRow("default v3")
        await act(async () =>
            document
                .querySelector<HTMLButtonElement>("[aria-label='Remove default - v3']")
                ?.click(),
        )
        expect(chips("Revision")).toEqual([])
    })

    it("Advanced Settings shows its check with the default settings", async () => {
        await mount("auto", "app-1")
        expect(document.querySelector("[aria-label='Advanced Settings complete']")).not.toBeNull()
    })

    it("The auto name follows the picks", async () => {
        await mount("auto", "app-1")
        await clickRow("default v3")
        await openStep("Test set")
        await clickRow("greetings")
        const name = document.querySelector<HTMLInputElement>("input[placeholder='Enter a name']")
        expect(name?.value).toMatch(/^default-v3-greetings-[a-z0-9]{5}$/)
    })

    it("An invalid start opens the failing step and keeps the sheet open", async () => {
        hook.start.mockResolvedValue({status: "invalid", section: "evaluators"})
        await mount("auto", "app-1")

        await act(async () => buttonByName("Start Evaluation")?.click())

        expect(activeStep()).toBe("Evaluators")
        expect(onClose).not.toHaveBeenCalled()
        expect(onStarted).not.toHaveBeenCalled()
    })

    it("A failed start keeps the picks and the sheet", async () => {
        hook.start.mockResolvedValue({status: "failed"})
        await mount("auto", "app-1")
        await clickRow("default v3")

        await act(async () => buttonByName("Start Evaluation")?.click())

        expect(onClose).not.toHaveBeenCalled()
        expect(chips("Revision")).toEqual(["default - v3"])
    })

    it("A started evaluation closes the sheet without asking and reports its kind", async () => {
        await mount("auto", "app-1")
        await clickRow("default v3")
        await act(async () => buttonByName("Start Evaluation")?.click())
        expect(confirmDialog()).toBeNull()
        expect(onStarted).toHaveBeenCalledWith("auto")
        expect(onClose).toHaveBeenCalled()
    })
})
