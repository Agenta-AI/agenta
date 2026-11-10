// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AppSection} from "@/features/evaluations/new/AppSection"
import type {DraftRevision, DraftTestset} from "@/features/evaluations/new/newEvaluationDraft"
import {RevisionSection} from "@/features/evaluations/new/RevisionSection"
import {TestsetSection} from "@/features/evaluations/new/TestsetSection"

import {resetWizardData, revisionRow, wizardData} from "../support/newEvaluationMocks"

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
    "@agenta/entity-ui/variant",
    async () => (await import("../support/newEvaluationMocks")).variantUiMock,
)
vi.mock(
    "@agenta/entity-ui/workflow",
    async () => (await import("../support/newEvaluationMocks")).workflowUiMock,
)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let wide = true

const mount = async (node: ReactNode) => {
    await act(async () => root.render(<Provider store={createStore()}>{node}</Provider>))
}

/** The column headers of the table, in order, without the pick column. */
const headers = () =>
    [...host.querySelectorAll("[role=columnheader]")]
        .map((cell) => cell.textContent?.trim())
        .filter((text) => text && text !== "Select")
/** A body row of the table: a grid row that is not the header. */
const rowByText = (text: string) =>
    [...host.querySelectorAll<HTMLElement>("div.grid")]
        .filter((row) => row.getAttribute("role") !== "row")
        .find((row) => row.textContent?.includes(text))
const byLabel = (label: string) => host.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

beforeEach(() => {
    resetWizardData()
    wide = true
    window.matchMedia = ((query: string) => ({
        matches: wide,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    vi.useFakeTimers({shouldAdvanceTime: true})
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
})

const noop = () => undefined

describe("application step", () => {
    beforeEach(() => {
        wizardData.apps = [
            {id: "app-1", name: "Capital finder", created_at: "2026-11-05T19:32:00Z"},
            {id: "app-2", name: "Support bot", created_at: "2026-11-05T19:32:00Z"},
        ]
        wizardData.appTypes = {"app-1": "completion", "app-2": "chat"}
    })

    it("The app step is a table with Name, Kind, Type and Created At", async () => {
        await mount(<AppSection selectedId={null} onPick={noop} />)
        expect(headers()).toEqual(["Name", "Kind", "Type", "Created At"])
        const row = rowByText("Capital finder")?.textContent ?? ""
        expect(row).toContain("App")
        expect(row).toContain("completion")
        expect(row).toContain("2026")
        expect(host.textContent).toContain(
            "Please select an application to continue configuring the evaluation.",
        )
    })

    it("The app step leaves out evaluators", async () => {
        wizardData.apps.push({id: "ev-1", name: "Exact match", flags: {is_evaluator: true}})
        await mount(<AppSection selectedId={null} onPick={noop} />)
        expect(rowByText("Exact match")).toBeUndefined()
        expect(rowByText("Support bot")).toBeDefined()
    })

    it("The search narrows the apps by name", async () => {
        await mount(<AppSection selectedId={null} onPick={noop} />)
        await typeInto(byLabel("Search applications") as HTMLInputElement, "support")
        expect(rowByText("Support bot")).toBeDefined()
        expect(rowByText("Capital finder")).toBeUndefined()
    })

    it("A click on a row picks that app", async () => {
        const onPick = vi.fn()
        await mount(<AppSection selectedId={null} onPick={onPick} />)
        await act(async () => rowByText("Support bot")?.click())
        expect(onPick).toHaveBeenCalledWith({id: "app-2", name: "Support bot"})
    })

    it("A scoped app cannot change and shows no type filter", async () => {
        const onPick = vi.fn()
        await mount(<AppSection selectedId="app-1" locked onPick={onPick} />)
        await act(async () => rowByText("Support bot")?.click())
        expect(onPick).not.toHaveBeenCalled()
        expect(byLabel("Filter by type")).toBeNull()
    })

    it("A failed app list shows Could not load apps with a retry", async () => {
        const refetch = vi.fn()
        wizardData.appsError = true
        wizardData.refetchApps = refetch
        await mount(<AppSection selectedId={null} onPick={noop} />)
        expect(host.textContent).toContain("Could not load apps")
    })

    it("An empty project says No applications available", async () => {
        wizardData.apps = []
        await mount(<AppSection selectedId={null} onPick={noop} />)
        expect(host.textContent).toContain("No applications available")
    })

    it("A phone keeps the name and the type", async () => {
        wide = false
        await mount(<AppSection selectedId={null} onPick={noop} />)
        expect(headers()).toEqual(["Name", "Type"])
    })
})

describe("revision step", () => {
    beforeEach(() => {
        wizardData.revisions = [
            revisionRow("rev-v5", "verbose", 5, {message: "verbose prompt v2"}),
            revisionRow("rev-d3", "default", 3, {
                message: "Tune prompt (2)",
                model: "mistral-small",
            }),
            revisionRow("rev-d2", "default", 2, {message: "Tune prompt (1)"}),
        ]
        wizardData.latestRevisionId = "rev-v5"
    })

    const mountRevisions = (
        kind: "auto" | "human",
        onPick: (revision: DraftRevision) => void = noop,
        selected: DraftRevision[] = [],
    ) =>
        mount(
            <RevisionSection
                kind={kind}
                projectId="pr"
                appId="app-1"
                selected={selected}
                onPick={onPick}
            />,
        )

    it("The revision step shows the /w columns: model, created on, created by and commit notes", async () => {
        await mountRevisions("auto")
        expect(headers()).toEqual(["Name", "Model", "Created on", "Created by", "Commit notes"])
        const row = rowByText("default v3")?.textContent ?? ""
        expect(row).toContain("mistral-small")
        expect(row).toContain("Tune prompt (2)")
        // The newest revision of the app carries the Last modified tag.
        expect(rowByText("verbose v5")?.textContent).toContain("Last modified")
    })

    it("Each variant shows its newest revision, and its older revisions open under it", async () => {
        await mountRevisions("auto")
        expect(rowByText("default v2")).toBeUndefined()
        await act(async () => byLabel("Show older revisions of default")?.click())
        expect(rowByText("default v2")?.textContent).toContain("Tune prompt (1)")
        // Opening the older revisions picks nothing.
        expect(byLabel("Select default v2")?.getAttribute("data-state")).toBe("unchecked")
    })

    it("An auto evaluation picks several revisions with checkboxes", async () => {
        const onPick = vi.fn()
        await mountRevisions("auto", onPick, [{id: "rev-v5", variantName: "verbose", version: 5}])
        expect(byLabel("Select verbose v5")?.getAttribute("role")).toBe("checkbox")
        expect(byLabel("Select verbose v5")?.getAttribute("data-state")).toBe("checked")
        await act(async () => rowByText("default v3")?.click())
        expect(onPick).toHaveBeenCalledWith({id: "rev-d3", variantName: "default", version: 3})
    })

    it("A human evaluation picks one revision with a radio", async () => {
        const onPick = vi.fn()
        await mountRevisions("human", onPick)
        expect(byLabel("Select default v3")?.getAttribute("role")).toBe("radio")
        await act(async () => byLabel("Select default v3")?.click())
        expect(onPick).toHaveBeenCalledWith({id: "rev-d3", variantName: "default", version: 3})
    })

    it("The search goes to the revision query", async () => {
        await mountRevisions("auto")
        await typeInto(byLabel("Search revisions") as HTMLInputElement, "verb")
        await act(async () => vi.advanceTimersByTime(400))
        expect(wizardData.searches.revisions).toBe("verb")
    })
})

describe("test set step", () => {
    beforeEach(() => {
        wizardData.testsets = [
            {
                id: "ts-1",
                name: "Capitals",
                created_at: "2026-11-05T19:32:00Z",
                created_by_id: "user-1",
            },
            {id: "ts-2", name: "Support tickets", created_at: null, created_by_id: null},
        ]
        wizardData.testsetRevisions = {
            "ts-1": {id: "ts-1-rev-3", version: 3, message: "Add Peru"},
            "ts-2": {id: "ts-2-rev-1", version: 1, message: "Initial commit"},
        }
    })

    const mountTestsets = (
        onPick: (testset: DraftTestset) => void = noop,
        selected: DraftTestset | null = null,
        revisions: DraftRevision[] = [],
    ) =>
        mount(
            <TestsetSection
                projectId="pr"
                revisions={revisions}
                selected={selected}
                onPick={onPick}
            />,
        )

    it("The test set step is an inline table with Name, Commit Message, Date Created and Created by", async () => {
        await mountTestsets()
        expect(headers()).toEqual(["Name", "Commit Message", "Date Created", "Created by"])
        expect(rowByText("Capitals")?.textContent).toContain("Add Peru")
        // A message the system wrote on its own is not shown.
        expect(rowByText("Support tickets")?.textContent).not.toContain("Initial commit")
    })

    it("Picking a test set takes its latest revision", async () => {
        const onPick = vi.fn()
        await mountTestsets(onPick)
        await act(async () => rowByText("Capitals")?.click())
        expect(onPick).toHaveBeenCalledWith({
            revisionId: "ts-1-rev-3",
            testsetId: "ts-1",
            name: "Capitals",
            version: 3,
        })
    })

    it("A test set waits for its latest revision before it can be picked", async () => {
        wizardData.testsetRevisions = {}
        const onPick = vi.fn()
        await mountTestsets(onPick)
        await act(async () => rowByText("Capitals")?.click())
        expect(onPick).not.toHaveBeenCalled()
    })

    it("The picked test set shows checked", async () => {
        await mountTestsets(noop, {
            revisionId: "ts-1-rev-3",
            testsetId: "ts-1",
            name: "Capitals",
            version: 3,
        })
        expect(byLabel("Select Capitals")?.getAttribute("data-state")).toBe("checked")
        expect(byLabel("Select Support tickets")?.getAttribute("data-state")).toBe("unchecked")
    })

    it("The test set step lists the expected input variables", async () => {
        wizardData.revisionData = {
            "rev-a": {
                id: "rev-a",
                data: {parameters: {prompt: {input_keys: ["country", "language"]}}},
            },
        }
        await mountTestsets(noop, null, [{id: "rev-a", variantName: "default", version: 3}])
        expect(host.textContent).toContain(
            "Expected input variables for selected variant(s): country, language",
        )
    })
})
