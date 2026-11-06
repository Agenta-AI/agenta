// @vitest-environment jsdom
// The shared evaluator picker in the app playground: automatic evaluators only, with their type
// tags and categories (the enriched adapter), loaded on first press, and an optional Create new.
import {act, createElement} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The file itself: the panel barrel pulls in pickers this test does not need. Mocks are hoisted.
import {EvaluatorPicker} from "../../../packages/agenta-playground-ui/src/panels/evaluator/EvaluatorPicker"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => ({
    nodes: [] as {id: string; entityId: string; depth: number}[],
    connect: vi.fn(),
    disconnect: vi.fn(),
    activate: vi.fn(),
    adapterArgs: [] as unknown[],
    pickerProps: {} as Record<string, unknown>,
}))

vi.mock("@agenta/playground", async () => {
    const {atom} = await import("jotai")
    const nodes = atom(() => fake.nodes)
    return {
        playgroundController: {
            selectors: {nodes: () => nodes},
            actions: {
                connectDownstreamNode: atom(null, (_get, _set, value: unknown) =>
                    fake.connect(value),
                ),
                disconnectSingleDownstreamNode: atom(null, (_get, _set, nodeId: string) =>
                    fake.disconnect(nodeId),
                ),
            },
        },
    }
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const empty = atom(null)
    const revision = atom({workflow_id: "eval-1", version: 2})
    return {
        activateEvaluatorEnrichmentAtom: atom(null, () => fake.activate()),
        evaluatorWorkflowMetaMapAtom: atom(new Map([["eval-1", {versionCount: 3}]])),
        workflowMolecule: {
            selectors: {
                artifactName: () => empty,
                data: (id: string) => (id === "eval-r2" ? revision : empty),
            },
        },
    }
})
vi.mock("@agenta/entity-ui/selection", async () => {
    const {createElement: h} = await import("react")
    return {
        useEnrichedEvaluatorOnlyAdapter: (...args: unknown[]) => {
            fake.adapterArgs = args
            return "evaluator-only-adapter"
        },
        EntityPicker: (props: Record<string, unknown>) => {
            fake.pickerProps = props
            const onSelect = props.onSelect as (selection: {id: string; label: string}) => void
            return h(
                "button",
                {type: "button", onClick: () => onSelect({id: "eval-r2", label: "Exact Match"})},
                "Evaluator",
            )
        },
    }
})

let host: HTMLDivElement
let root: Root

const mount = async (onCreateNew?: () => void) => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store: createStore()},
                createElement(EvaluatorPicker, {onCreateNew}),
            ),
        )
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    fake.nodes = [{id: "n-app", entityId: "app-r1", depth: 0}]
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
})

describe("Playground EvaluatorPicker", () => {
    it("lists automatic evaluators only, with types, and loads them on first press", async () => {
        await mount()
        expect(fake.pickerProps.adapter).toBe("evaluator-only-adapter")
        expect(fake.adapterArgs[1]).toEqual({showWorkflowMeta: true, lazy: true})
        expect(fake.activate).not.toHaveBeenCalled()
        const trigger = host.querySelector("button") as HTMLButtonElement
        await act(async () => {
            trigger.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true}))
        })
        expect(fake.activate).toHaveBeenCalled()
    })

    it("connects a picked evaluator after the app", async () => {
        await mount()
        await act(async () => (host.querySelector("button") as HTMLButtonElement).click())
        expect(fake.connect).toHaveBeenCalledWith({
            sourceNodeId: "n-app",
            entity: {type: "workflow", id: "eval-r2", label: "Exact Match"},
        })
    })

    it("ticks a connected revision, and a second pick takes it off, as in /w", async () => {
        fake.nodes = [
            {id: "n-app", entityId: "app-r1", depth: 0},
            {id: "n-eval", entityId: "eval-r2", depth: 1},
        ]
        await mount()
        expect(fake.pickerProps).toMatchObject({
            multiSelect: true,
            selectionSummary: true,
            showParentCheckboxes: true,
            showDropdownIcon: true,
            popupClassName: "ag-playground-colors",
        })
        expect([...(fake.pickerProps.selectedChildIds as Set<string>)]).toEqual(["eval-r2"])
        const byEvaluator = fake.pickerProps.selectedChildrenByParent as Map<string, unknown>
        expect(byEvaluator.get("eval-1")).toEqual([{id: "eval-r2", label: "v2"}])
        expect((fake.pickerProps.totalChildrenByParent as Map<string, number>).get("eval-1")).toBe(
            3,
        )

        const onSelect = fake.pickerProps.onSelect as (selection: {
            id: string
            label: string
        }) => void
        await act(async () => onSelect({id: "eval-r2", label: "Exact Match"}))
        expect(fake.disconnect).toHaveBeenCalledWith("n-eval")
        expect(fake.connect).not.toHaveBeenCalled()
        const onDeselect = fake.pickerProps.onDeselectChild as (id: string) => void
        await act(async () => onDeselect("eval-r2"))
        expect(fake.disconnect).toHaveBeenCalledTimes(2)
    })

    it("offers Create new only when the host gives it", async () => {
        await mount()
        expect(fake.pickerProps.onCreateNew).toBeUndefined()
        const create = vi.fn()
        await mount(create)
        expect(fake.pickerProps.onCreateNew).toBe(create)
        expect(fake.pickerProps.createNewLabel).toBe("Create new evaluator")
    })
})
