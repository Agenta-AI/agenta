// @vitest-environment jsdom
import {act, useReducer, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AdvancedSettingsSection} from "@/features/evaluations/new/AdvancedSettingsSection"
import {EvaluatorsSection} from "@/features/evaluations/new/EvaluatorsSection"
import {
    createInitialDraft,
    newEvaluationReducer,
    type DraftEvaluator,
    type NewEvaluationKind,
} from "@/features/evaluations/new/newEvaluationDraft"

import {
    autoEvaluator,
    humanEvaluator,
    resetWizardData,
    wizardData,
} from "../support/newEvaluationMocks"

vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    ...(await import("../support/newEvaluationMocks")).workflowOverrides,
}))
vi.mock(
    "@/features/evaluators/useEvaluators",
    async () => (await import("../support/newEvaluationMocks")).evaluatorsMock,
)
vi.mock(
    "@/features/evaluators/useEvaluatorRevisions",
    async () => (await import("../support/newEvaluationMocks")).evaluatorRevisionsMock,
)
vi.mock(
    "@agenta/entity-ui/workflow",
    async () => (await import("../support/newEvaluationMocks")).workflowUiMock,
)
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const mount = async (node: ReactNode) => {
    await act(async () => root.render(<Provider store={createStore()}>{node}</Provider>))
}

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

beforeEach(() => {
    resetWizardData()
    window.matchMedia = ((query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const mountEvaluators = (
    kind: NewEvaluationKind,
    {
        evaluatorsHref = "/w/ws/p/pr/evaluators",
        onPick = () => undefined,
        selected = [],
    }: {
        evaluatorsHref?: string | null
        onPick?: (evaluator: DraftEvaluator) => void
        selected?: DraftEvaluator[]
    } = {},
) =>
    mount(
        <EvaluatorsSection
            kind={kind}
            projectId="pr"
            selected={selected}
            evaluatorsHref={evaluatorsHref}
            onPick={onPick}
        />,
    )

describe("evaluators step", () => {
    beforeEach(() => {
        wizardData.evaluators = {
            automatic: [autoEvaluator("ev-exact", "Exact Match", 2)],
            human: [
                humanEvaluator("ev-help", "Helpfulness", ["score", "comment"]),
                humanEvaluator("ev-rate", "Quality Rating", ["approved"]),
            ],
        }
    })

    it("An auto run lists automatic evaluators in a table with the /w columns", async () => {
        await mountEvaluators("auto")
        expect(headers()).toEqual([
            "Name",
            "Type",
            "Tags",
            "Date Created",
            "Last modified",
            "Modified by",
            "Commit message",
        ])
        const row = rowByText("Exact Match")?.textContent ?? ""
        expect(row).toContain("v2")
        expect(row).toContain("auto_exact_match")
        expect(row).toContain("classifiers")
        expect(row).toContain("Tighten the match")
        expect(rowByText("Helpfulness")).toBeUndefined()
    })

    it("A human run shows the Feedback column with the fields each evaluator asks for", async () => {
        await mountEvaluators("human")
        expect(headers()).toEqual([
            "Name",
            "Feedback",
            "Date Created",
            "Last modified",
            "Modified by",
        ])
        expect(rowByText("Helpfulness")?.textContent).toContain("scorecomment")
        expect(rowByText("Quality Rating")?.textContent).toContain("approved")
        expect(rowByText("Exact Match")).toBeUndefined()
    })

    it("Older versions of an evaluator open under its newest one", async () => {
        wizardData.evaluatorRevisions = [
            {...wizardData.evaluators.automatic[0].latestRevision},
            {
                id: "ev-exact-rev-1",
                workflow_id: "ev-exact",
                version: 1,
                data: {uri: "agenta:builtin:auto_exact_match:v0"},
            },
        ]
        await mountEvaluators("auto")
        expect(byLabel("Select Exact Match v1")).toBeNull()
        await act(async () => byLabel("Show older versions of Exact Match")?.click())
        expect(byLabel("Select Exact Match v1")).not.toBeNull()
    })

    it("A click on a row picks that evaluator revision", async () => {
        const onPick = vi.fn()
        await mountEvaluators("human", {onPick})
        await act(async () => rowByText("Quality Rating")?.click())
        expect(onPick).toHaveBeenCalledWith({
            revisionId: "ev-rate-rev-1",
            evaluatorId: "ev-rate",
            name: "Quality Rating",
            version: 1,
        })
    })

    it("Create new evaluator opens the evaluators page on the right tab in a new tab", async () => {
        await mountEvaluators("human")
        const link = [...host.querySelectorAll("a")].find(
            (a) => a.textContent === "Create new evaluator",
        )
        expect(link?.getAttribute("href")).toBe("/w/ws/p/pr/evaluators?tab=human")
        expect(link?.getAttribute("target")).toBe("_blank")
    })

    it("Create new evaluator is absent while the evaluators view is off", async () => {
        await mountEvaluators("auto", {evaluatorsHref: null})
        expect(host.textContent).not.toContain("Create new evaluator")
    })

    it("No evaluators shows No evaluators yet with a link in a new tab", async () => {
        wizardData.evaluators = {automatic: [], human: []}
        await mountEvaluators("auto")
        expect(host.textContent).toContain("No evaluators yet")
        const link = [...host.querySelectorAll("a")].find(
            (a) => a.textContent === "Create your first evaluator",
        )
        expect(link?.getAttribute("href")).toBe("/w/ws/p/pr/evaluators?tab=automatic")
        expect(link?.getAttribute("target")).toBe("_blank")
    })

    it("A failed evaluator list shows Could not load evaluators with a retry", async () => {
        const refetch = vi.fn()
        wizardData.evaluatorsError = true
        wizardData.refetchEvaluators = refetch
        await mountEvaluators("auto")
        expect(host.textContent).toContain("Could not load evaluators")
        // The error state's one button is its retry.
        await act(async () => host.querySelector("button")?.click())
        expect(refetch).toHaveBeenCalled()
    })
})

describe("advanced settings section", () => {
    const Harness = () => {
        const [draft, dispatch] = useReducer(
            newEvaluationReducer,
            createInitialDraft("auto", {suffix: "abc12"}),
        )
        return (
            <>
                <AdvancedSettingsSection
                    concurrency={draft.concurrency}
                    onChange={(field, value) => dispatch({type: "setConcurrency", field, value})}
                    onReset={() => dispatch({type: "resetConcurrency"})}
                />
                <output>{JSON.stringify(draft.concurrency)}</output>
            </>
        )
    }

    const type = async (input: HTMLInputElement, value: string) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
        await act(async () => {
            setter?.call(input, value)
            input.dispatchEvent(new Event("input", {bubbles: true}))
            input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}))
            input.blur()
        })
    }

    it("Reset changes appears after a concurrency edit and restores 10, 3 and 3", async () => {
        await mount(<Harness />)
        const reset = () =>
            [...host.querySelectorAll("button")].find((b) => b.textContent === "Reset changes")
        expect(reset()).toBeUndefined()

        const [batch] = host.querySelectorAll("input")
        await type(batch, "4")
        expect(host.querySelector("output")?.textContent).toBe(
            '{"batch_size":4,"max_retries":3,"retry_delay":3}',
        )
        expect(reset()).toBeDefined()

        await act(async () => reset()?.click())
        expect(host.querySelector("output")?.textContent).toBe(
            '{"batch_size":10,"max_retries":3,"retry_delay":3}',
        )
        expect(reset()).toBeUndefined()
    })

    it("An empty field shows This field is required", async () => {
        await mount(<Harness />)
        const [batch] = host.querySelectorAll("input")
        await type(batch, "")
        expect(host.textContent).toContain("This field is required")
        expect(host.querySelector("output")?.textContent).toContain('"batch_size":null')
    })
})
