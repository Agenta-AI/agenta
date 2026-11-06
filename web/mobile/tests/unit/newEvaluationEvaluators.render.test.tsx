// @vitest-environment jsdom
import {act, useReducer} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AdvancedSettingsSection} from "@/features/evaluations/new/AdvancedSettingsSection"
import {EvaluatorsSection} from "@/features/evaluations/new/EvaluatorsSection"
import {
    createInitialDraft,
    newEvaluationReducer,
} from "@/features/evaluations/new/newEvaluationDraft"

import {pickers, resetWizardData, wizardData} from "../support/newEvaluationMocks"

const env = vi.hoisted(() => ({evaluatorsViewOn: false, beta: false, flowKind: "" as string}))

vi.mock("@agenta/shared/state", async (original) => {
    const {atom} = await import("jotai")
    return {...(await original<object>()), betaDeveloperModeActiveAtom: atom(() => env.beta)}
})
// The create flow is a separate chunk: a stand-in that "creates" one at once.
vi.mock("next/dynamic", () => ({
    default:
        () =>
        ({
            kind,
            onCreated,
        }: {
            kind: string
            onCreated: (created: Record<string, unknown>) => void
        }) => {
            env.flowKind = kind
            return (
                <button
                    type="button"
                    onClick={() =>
                        onCreated({
                            workflowId: "wf-9",
                            revisionId: "rev-9",
                            name: "Tone",
                            slug: "tone",
                            version: 1,
                        })
                    }
                >
                    Save new evaluator
                </button>
            )
        },
}))

vi.mock("@agenta/entities/workflow", async (original) => ({
    ...(await original<object>()),
    ...(await import("../support/newEvaluationMocks")).workflowOverrides,
}))
vi.mock(
    "@agenta/entity-ui/selection",
    async () => (await import("../support/newEvaluationMocks")).selectionMock,
)
vi.mock("next/link", () => ({
    default: ({href, children}: {href: string; children: React.ReactNode}) => (
        <a href={href}>{children}</a>
    ),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const mount = async (node: React.ReactNode) => {
    await act(async () => root.render(<Provider store={createStore()}>{node}</Provider>))
}

beforeEach(() => {
    resetWizardData()
    env.evaluatorsViewOn = false
    env.beta = false
    env.flowKind = ""
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

const noop = () => undefined
const onPick = vi.fn()
const section = (kind: "auto" | "human", allowAutomaticCreate = false) => (
    <EvaluatorsSection
        kind={kind}
        hasApp
        selected={[]}
        evaluatorsHref={env.evaluatorsViewOn ? "/w/ws/p/pr/evaluators" : null}
        onPick={onPick}
        onRemove={noop}
        onClear={noop}
        allowAutomaticCreate={allowAutomaticCreate}
    />
)
const pickerCreate = (instance: string) =>
    pickers.latest[instance]?.onCreateNew as (() => void) | undefined

describe("evaluators section create", () => {
    it("Without beta developer mode neither picker offers create", async () => {
        wizardData.evaluatorCount = 2
        await mount(section("auto", true))
        expect(pickerCreate("new-evaluation-auto-evaluator")).toBeUndefined()
        await mount(section("human"))
        expect(pickerCreate("new-evaluation-human-evaluator")).toBeUndefined()
    })

    it("Automatic create shows only where the host allows the drawer", async () => {
        env.beta = true
        wizardData.evaluatorCount = 2
        await mount(section("auto"))
        expect(pickerCreate("new-evaluation-auto-evaluator")).toBeUndefined()
        await mount(section("auto", true))
        expect(pickerCreate("new-evaluation-auto-evaluator")).toBeTypeOf("function")
    })

    it("A human evaluator created from the picker is picked for the run", async () => {
        env.beta = true
        wizardData.evaluatorCount = 1
        await mount(section("human"))
        await act(async () => pickerCreate("new-evaluation-human-evaluator")?.())
        expect(env.flowKind).toBe("human")
        const save = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Save new evaluator",
        )
        await act(async () => save?.click())
        expect(onPick).toHaveBeenCalledWith({
            revisionId: "rev-9",
            evaluatorId: "wf-9",
            name: "Tone",
            version: 1,
        })
    })
})

describe("evaluators section", () => {
    it("Auto mode lists automatic evaluators only", async () => {
        wizardData.evaluatorCount = 2
        await mount(section("auto"))
        expect(Object.keys(pickers.latest)).toEqual(["new-evaluation-auto-evaluator"])
        expect(pickers.latest["new-evaluation-auto-evaluator"].showChildSelectAll).toBe(true)
    })

    it("Human mode lists human evaluators with their metric summary", async () => {
        wizardData.evaluatorCount = 1
        await mount(section("human"))
        const picker = pickers.latest["new-evaluation-human-evaluator"]
        expect(Object.keys(pickers.latest)).toEqual(["new-evaluation-human-evaluator"])

        const adapter = picker.adapter as {kind: string}
        expect(adapter.kind).toBe("human")
        // A human run takes one revision of each evaluator, so there is no select all.
        expect(picker.showChildSelectAll).toBe(false)
        expect(picker.showParentCheckboxes).toBe(false)
    })

    it("The evaluator label shows the name, the version and the metrics of a human evaluator", async () => {
        const {renderEvaluatorRevisionLabel} =
            await import("@/features/evaluations/new/EvaluatorRevisionLabel")
        await mount(
            renderEvaluatorRevisionLabel({
                id: "ev-rev-1",
                version: 2,
                flags: {is_feedback: true},
                data: {
                    schemas: {
                        outputs: {
                            properties: {
                                score: {type: "number", minimum: 1, maximum: 5},
                            },
                        },
                    },
                },
            }),
        )
        expect(host.textContent).toContain("Helpfulness")
        expect(host.textContent).toContain("v2")
        expect(host.textContent?.toLowerCase()).toContain("score")
    })

    it("No evaluators shows No evaluators yet", async () => {
        await mount(section("auto"))
        expect(host.textContent).toContain("No evaluators yet")
        expect(host.textContent).toContain(
            "Evaluators help you measure and analyze your model's responses.",
        )
        expect(Object.keys(pickers.latest)).toEqual([])
    })

    it("A failed evaluator list shows Could not load evaluators with a retry", async () => {
        wizardData.evaluatorsError = true
        const refetch = vi.fn()
        wizardData.refetchEvaluators = refetch
        await mount(section("auto"))

        expect(host.textContent).toContain("Could not load evaluators")
        expect(host.textContent).not.toContain("No evaluators yet")
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        await act(async () => retry?.click())
        expect(refetch).toHaveBeenCalled()
    })

    it("Open evaluators is absent while the evaluators view is off", async () => {
        await mount(section("auto"))
        expect(host.textContent).not.toContain("Open evaluators")

        env.evaluatorsViewOn = true
        await mount(section("auto"))
        const link = host.querySelector("a")
        expect(link?.textContent).toBe("Open evaluators")
        expect(link?.getAttribute("href")).toBe("/w/ws/p/pr/evaluators")
    })

    it("Before an app is picked the evaluators section says Select an application first", async () => {
        await mount(
            <EvaluatorsSection
                kind="auto"
                hasApp={false}
                selected={[]}
                evaluatorsHref={null}
                onPick={noop}
                onRemove={noop}
                onClear={noop}
            />,
        )
        expect(host.textContent).toContain("Select an application first to load this section.")
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
