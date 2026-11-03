// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AppSection} from "@/features/evaluations/new/AppSection"
import {
    createInitialDraft,
    newEvaluationReducer,
} from "@/features/evaluations/new/newEvaluationDraft"
import {RevisionSection} from "@/features/evaluations/new/RevisionSection"
import {TestsetSection} from "@/features/evaluations/new/TestsetSection"

import {pickers, resetWizardData, wizardData} from "../support/newEvaluationMocks"

vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    ...(await import("../support/newEvaluationMocks")).workflowOverrides,
}))
vi.mock(
    "@agenta/entity-ui/selection",
    async () => (await import("../support/newEvaluationMocks")).selectionMock,
)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const mount = async (node: React.ReactNode) => {
    await act(async () => root.render(<Provider store={createStore()}>{node}</Provider>))
}

beforeEach(() => {
    resetWizardData()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const noop = () => undefined

describe("application section", () => {
    it("The app list shows only non-evaluator apps with their type", async () => {
        wizardData.apps = [
            {id: "a1", name: "Support bot", flags: {is_chat: true}},
            {id: "a2", name: "Summarizer"},
            {id: "a3", name: "Custom service", flags: {is_custom: true}},
            {id: "e1", name: "Exact match", flags: {is_evaluator: true}},
        ]
        await mount(<AppSection selectedId={null} onPick={noop} />)

        const rows = [...host.querySelectorAll("li")].map((li) => li.textContent)
        expect(rows).toEqual(["Support botChat", "SummarizerCompletion", "Custom serviceCustom"])
        expect(host.textContent).not.toContain("Exact match")
    })

    it("Picking an app reports it", async () => {
        wizardData.apps = [{id: "a2", name: "Summarizer", flags: {is_custom: true}}]
        const onPick = vi.fn()
        await mount(<AppSection selectedId={null} onPick={onPick} />)

        await act(async () => host.querySelector("button")?.click())

        expect(onPick).toHaveBeenCalledWith({id: "a2", name: "Summarizer", isCustom: true})
    })

    it("A failed app list shows Could not load apps with a retry", async () => {
        wizardData.appsError = true
        const refetch = vi.fn()
        wizardData.refetchApps = refetch
        await mount(<AppSection selectedId={null} onPick={noop} />)

        expect(host.textContent).toContain("Could not load apps")
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        await act(async () => retry?.click())
        expect(refetch).toHaveBeenCalled()
    })

    it("An empty project says No applications available", async () => {
        await mount(<AppSection selectedId={null} onPick={noop} />)
        expect(host.textContent).toContain("No applications available")
    })
})

describe("revision section", () => {
    it("Before an app is picked the revision section says Select an application first", async () => {
        await mount(
            <RevisionSection
                kind="auto"
                appId={null}
                selected={[]}
                onPick={noop}
                onRemove={noop}
            />,
        )
        expect(host.textContent).toContain("Select an application first to load this section.")
        expect(Object.keys(pickers.latest)).toEqual([])
    })

    it("Human mode picks one revision and opens the test set section", async () => {
        let draft = createInitialDraft("human", {suffix: "abc12"})
        draft = newEvaluationReducer(draft, {
            type: "pickApp",
            app: {id: "app-1", name: "Support bot", isCustom: false},
        })
        await mount(
            <RevisionSection
                kind="human"
                appId="app-1"
                selected={draft.revisions}
                onPick={(revision) => {
                    draft = newEvaluationReducer(draft, {type: "pickRevision", revision})
                }}
                onRemove={noop}
            />,
        )
        const picker = pickers.latest["new-evaluation-revision-app-1"]
        expect(picker.multiSelect).toBeUndefined()

        const select = picker.onSelect as (result: unknown) => void
        select({id: "rev-a", metadata: {variantName: "default", revision: 3}})
        select({id: "rev-b", metadata: {variantName: "concise", revision: 1}})

        expect(draft.revisions).toEqual([{id: "rev-b", variantName: "concise", version: 1}])
        expect(draft.section).toBe("testset")
    })

    it("Auto mode lets the picker take several revisions", async () => {
        await mount(
            <RevisionSection
                kind="auto"
                appId="app-1"
                selected={[]}
                onPick={noop}
                onRemove={noop}
            />,
        )
        expect(pickers.latest["new-evaluation-revision-app-1"].multiSelect).toBe(true)
    })
})

describe("test set section", () => {
    const testset = {revisionId: "ts-rev", testsetId: "ts", name: "greetings", version: 2}

    it("The test set section lists the expected input variables", async () => {
        wizardData.revisionData = {
            "rev-a": {
                data: {
                    parameters: {
                        ag_config: {
                            prompt: {
                                input_keys: ["country"],
                                messages: {value: [{content: {value: "About {{topic}}"}}]},
                            },
                        },
                    },
                },
            },
        }
        await mount(
            <TestsetSection
                hasApp
                revisions={[{id: "rev-a", variantName: "default", version: 1}]}
                selected={null}
                onPick={noop}
            />,
        )
        expect(host.textContent).toContain(
            "Expected input variables for selected variant(s): country, topic",
        )
    })

    it("Picking the selected test set revision again clears it", async () => {
        let draft = newEvaluationReducer(createInitialDraft("auto", {suffix: "abc12"}), {
            type: "pickTestset",
            testset,
        })
        await mount(
            <TestsetSection
                hasApp
                revisions={[]}
                selected={draft.testset}
                onPick={(picked) => {
                    draft = newEvaluationReducer(draft, {type: "pickTestset", testset: picked})
                }}
            />,
        )
        const picker = pickers.latest["new-evaluation-testset"]
        expect(picker.selectedChildId).toBe("ts-rev")
        ;(picker.onSelect as (result: unknown) => void)({
            id: "ts-rev",
            metadata: {testsetId: "ts", testsetName: "greetings", revisionId: "ts-rev", version: 2},
        })

        expect(draft.testset).toBeNull()
    })

    it("Before an app is picked the test set section says Select an application first", async () => {
        await mount(<TestsetSection hasApp={false} revisions={[]} selected={null} onPick={noop} />)
        expect(host.textContent).toContain("Select an application first to load this section.")
    })
})
