// @vitest-environment jsdom
// The annotation row of the traces filter dialog: the evaluator and feedback controls, the
// conditions they put in the trace query, and that the evaluator list loads only once a filter
// dialog with an annotation row is open. The evaluator atoms are stand-ins that count their reads.
import {act, type ReactNode} from "react"

import {buildTraceQueryParams, type Filter} from "@agenta/observability"
import type {AnnotationRowContext} from "@agenta/observability-ui"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fixture = vi.hoisted(() => ({
    viewEnabled: true,
    evaluatorReads: 0,
    enrichmentCalls: 0,
    filters: [] as unknown[],
}))

vi.mock("@agenta/entities/workflow", async (original) => {
    const actual = await original<typeof import("@agenta/entities/workflow")>()
    const {atom: makeAtom} = await import("jotai")
    return {
        ...actual,
        evaluatorsListDataAtom: makeAtom(() => {
            fixture.evaluatorReads += 1
            return [
                {id: "ev-1", slug: "tone-check", name: "Tone check"},
                {id: "ev-2", slug: "fact-check", name: ""},
            ]
        }),
        evaluatorFeedbackSchemasAtom: makeAtom(() => [
            {
                slug: "tone-check",
                name: "Tone check",
                properties: {score: {type: "number", title: "Score"}, label: {type: "string"}},
            },
            {slug: "fact-check", name: "", properties: {correct: {type: "boolean"}}},
        ]),
    }
})
vi.mock("@agenta/entity-ui/selection", () => ({
    useEnsureEvaluatorEnrichment: () => {
        fixture.enrichmentCalls += 1
    },
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) => id === "observability-actions" && fixture.viewEnabled,
}))
vi.mock("@agenta/observability", async (original) => ({
    ...(await original<object>()),
    useObservability: () => ({filters: fixture.filters, setFilters: vi.fn(), traces: []}),
}))

import {AnnotationRowControls} from "@/features/observability/filters/AnnotationRowControls"
import {TracesFilters} from "@/features/observability/TracesFilters"

let root: Root
let host: HTMLElement
let store: ReturnType<typeof createStore>

/** Each test gets its own store, so an evaluator list read in one test is not cached for the next. */
const show = (node: ReactNode) =>
    act(async () => root.render(<Provider store={store}>{node}</Provider>))

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

/** Renders one half of the annotation row, as the filter dialog would, and records its changes. */
const renderControls = async (
    part: "evaluator" | "feedback",
    value: AnnotationRowContext["value"],
) => {
    const changes: AnnotationRowContext["value"][] = []
    const context: AnnotationRowContext = {
        index: 0,
        item: {field: "has_annotation", operator: "in", value: value ? [value] : []},
        value,
        onChange: (next) => changes.push(next),
        onRemoveRow: vi.fn(),
        container: null,
        disabled: false,
    }
    await show(<AnnotationRowControls part={part} context={context} />)
    return changes
}

const options = () =>
    [...document.body.querySelectorAll<HTMLElement>("[role=option]")].map((node) =>
        node.textContent?.trim(),
    )
const option = (label: string) =>
    [...document.body.querySelectorAll<HTMLElement>("[role=option]")].find(
        (node) => node.textContent?.trim() === label,
    )
const combobox = (label: string) =>
    document.body.querySelector<HTMLInputElement>(`[role=combobox][aria-label="${label}"]`)

/** The trace query the dialog's annotation row value turns into. */
const queryFor = (value: AnnotationRowContext["value"]) =>
    buildTraceQueryParams(
        [{field: "has_annotation", operator: "in", value: [value]} as Filter],
        undefined,
        "trace",
    )

beforeEach(() => {
    fixture.viewEnabled = true
    fixture.evaluatorReads = 0
    fixture.enrichmentCalls = 0
    fixture.filters = []
    store = createStore()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("Annotation filters on the traces page", () => {
    it("The annotation row offers every evaluator by name", async () => {
        const changes = await renderControls("evaluator", {evaluator: undefined})

        await act(async () => combobox("Evaluator")?.focus())
        expect(options()).toEqual(["Tone check", "fact-check"])

        await act(async () => option("Tone check")?.click())
        expect(changes).toEqual([{evaluator: "tone-check"}])
        expect(queryFor(changes[0]).hasAnnotationConditions).toEqual([
            {
                field: "references",
                operator: "in",
                value: [{slug: "tone-check", "attributes.key": "evaluator"}],
            },
        ])
    })

    it("Feedback options come from the evaluator feedback schemas", async () => {
        const changes = await renderControls("feedback", {
            evaluator: "tone-check",
            feedback: {field: "", operator: "is", value: ""},
        })

        await act(async () =>
            combobox("Feedback")?.dispatchEvent(
                new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}),
            ),
        )
        expect(options()).toEqual(["Score", "label"])

        await act(async () => option("Score")?.click())
        const picked = changes[changes.length - 1]
        expect(picked).toMatchObject({evaluator: "tone-check", feedback: {field: "score"}})

        const query = queryFor({
            ...picked,
            feedback: {field: "score", operator: "gt", value: 0.5},
        })
        expect(query.isHasAnnotationSelected).toBe(0)
        expect(query.hasAnnotationConditions).toEqual([
            {
                field: "references",
                operator: "in",
                value: [{slug: "tone-check", "attributes.key": "evaluator"}],
            },
            {field: "attributes", key: "ag.data.outputs.score", operator: "gt", value: 0.5},
        ])
        // The annotation row narrows the query through the annotation step, not the plain filter.
        expect(query.params.filter).toBe(JSON.stringify({conditions: []}))
    })

    it("Evaluators are not requested until the dialog opens", async () => {
        fixture.filters = [
            {field: "has_annotation", operator: "in", value: [{evaluator: "tone-check"}]},
        ]
        await show(<TracesFilters />)
        await flush()
        expect(fixture.evaluatorReads).toBe(0)
        expect(fixture.enrichmentCalls).toBe(0)

        await act(async () => host.querySelector<HTMLButtonElement>("[aria-label=Filter]")?.click())
        await vi.waitFor(() => expect(combobox("Evaluator")).not.toBeNull())
        expect(fixture.evaluatorReads).toBeGreaterThan(0)
        expect(fixture.enrichmentCalls).toBeGreaterThan(0)
    })

    it("With the view off the filter dialog has no annotation controls", async () => {
        fixture.viewEnabled = false
        fixture.filters = [
            {field: "has_annotation", operator: "in", value: [{evaluator: "tone-check"}]},
        ]
        await show(<TracesFilters />)
        await act(async () => host.querySelector<HTMLButtonElement>("[aria-label=Filter]")?.click())
        await flush()

        expect(document.body.textContent).toContain("Has Annotation")
        expect(combobox("Evaluator")).toBeNull()
        expect(document.body.textContent).not.toContain("Add Evaluator")
        expect(fixture.evaluatorReads).toBe(0)
    })
})
