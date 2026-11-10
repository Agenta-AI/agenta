// @vitest-environment jsdom
import {act, useState, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {SelectedEvaluator} from "@/features/annotations/createQueueTypes"
import {QueueEvaluatorField} from "@/features/annotations/QueueEvaluatorField"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const picker = vi.hoisted(() => ({
    onSelect: null as null | ((result: unknown) => void),
    onDeselectChild: null as null | ((id: string) => void),
    renderLabel: null as null | ((entity: unknown) => ReactNode),
    onCreateNew: undefined as undefined | (() => void),
    beta: false,
}))

vi.mock("@agenta/shared/state", async (original) => {
    const {atom} = await import("jotai")
    return {...(await original<object>()), betaDeveloperModeActiveAtom: atom(() => picker.beta)}
})
// The create flow is a separate chunk: a stand-in that "creates" Tone at once.
vi.mock("next/dynamic", () => ({
    default:
        () =>
        ({onCreated}: {onCreated: (created: Record<string, unknown>) => void}) => (
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
        ),
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom: makeAtom} = await import("jotai")
    // An atom family: the same id gives the same atom, or the component would re-render forever.
    const names = new Map<string, ReturnType<typeof makeAtom<string | null>>>()
    const emptyData = makeAtom(null)
    const artifactName = (id: string) => {
        const existing = names.get(id)
        if (existing) return existing
        const created = makeAtom<string | null>(id === "rev-1" ? "Helpfulness" : null)
        names.set(id, created)
        return created
    }
    return {
        evaluatorWorkflowMetaMapAtom: makeAtom(new Map()),
        workflowMolecule: {selectors: {artifactName, data: () => emptyData}},
    }
})

vi.mock("@agenta/entity-ui/selection", () => ({
    useEnsureEvaluatorEnrichment: () => undefined,
    useEnrichedHumanEvaluatorAdapter: (renderLabel: (entity: unknown) => ReactNode) => {
        picker.renderLabel = renderLabel
        return {}
    },
    EntityPicker: ({
        onSelect,
        onDeselectChild,
        onCreateNew,
    }: {
        onSelect: (result: unknown) => void
        onDeselectChild: (id: string) => void
        onCreateNew?: () => void
    }) => {
        picker.onSelect = onSelect
        picker.onDeselectChild = onDeselectChild
        picker.onCreateNew = onCreateNew
        return null
    },
}))

vi.mock("@agenta/ui/components/presentational", () => ({
    VersionBadge: ({version}: {version: number}) => <span>v{version}</span>,
}))

const pick = (id: string) => ({
    id,
    metadata: {workflowId: "wf-1", workflowName: "Helpfulness", revision: 1, isHuman: true},
})
const existing = (id: string): SelectedEvaluator => ({
    evaluatorId: "wf-1",
    revisionId: id,
    evaluatorName: `Evaluator ${id}`,
    version: 1,
    isHuman: true,
})

describe("QueueEvaluatorField", () => {
    let root: Root
    let host: HTMLElement
    let latest: SelectedEvaluator[] = []

    const Harness = ({initial}: {initial: SelectedEvaluator[]}) => {
        const [selected, setSelected] = useState(initial)
        latest = selected
        return <QueueEvaluatorField selected={selected} onChange={setSelected} />
    }
    const mount = async (initial: SelectedEvaluator[] = []) => {
        await act(async () => {
            root.render(
                <Provider store={createStore()}>
                    <Harness initial={initial} />
                </Provider>,
            )
        })
    }

    beforeEach(() => {
        picker.beta = false
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
        host.remove()
    })

    it("Without beta developer mode the picker offers no create", async () => {
        await mount()
        expect(picker.onCreateNew).toBeUndefined()
    })

    it("In beta developer mode a created human evaluator is added to the queue", async () => {
        picker.beta = true
        await mount([existing("rev-1")])
        await act(async () => picker.onCreateNew?.())
        const save = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Save new evaluator",
        )
        await act(async () => save?.click())
        expect(latest).toEqual([
            existing("rev-1"),
            {
                evaluatorId: "wf-9",
                revisionId: "rev-9",
                evaluatorName: "Tone",
                version: 1,
                isHuman: true,
            },
        ])
    })

    it("Select all with several revisions selects all of them", async () => {
        await mount()
        await act(async () => {
            for (const id of ["rev-1", "rev-2", "rev-3"]) picker.onSelect?.(pick(id))
        })
        expect(latest.map((evaluator) => evaluator.revisionId)).toEqual(["rev-1", "rev-2", "rev-3"])
    })

    it("Deselecting a parent removes all of its revisions", async () => {
        await mount([existing("rev-1"), existing("rev-2"), existing("rev-3")])
        await act(async () => {
            for (const id of ["rev-1", "rev-2", "rev-3"]) picker.onDeselectChild?.(id)
        })
        expect(latest).toEqual([])
    })

    it("The revision label shows the evaluator name, not the revision name", async () => {
        await mount()
        await act(async () => {
            root.render(
                <Provider store={createStore()}>
                    {picker.renderLabel?.({id: "rev-1", name: "default", version: 2})}
                </Provider>,
            )
        })
        expect(host.textContent).toContain("Helpfulness")
        expect(host.textContent).not.toContain("default")
        expect(host.textContent).toContain("v2")
    })
})
