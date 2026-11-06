// @vitest-environment jsdom
// Creating an evaluator from another screen hands the new evaluator back, selected.
import {act, createElement, lazy, Suspense, type ComponentType} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {CreateEvaluatorFlow} from "@/features/evaluators/create/CreateEvaluatorFlow"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => ({localId: "local-9" as string | null}))

vi.mock("next/dynamic", () => ({
    default: (load: () => Promise<ComponentType<object>>) => {
        const Lazy = lazy(async () => ({default: await load()}))
        return (props: object) =>
            createElement(Suspense, {fallback: null}, createElement(Lazy, props))
    },
}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const data = atom({workflow_id: "w9", slug: "rev-slug", version: 1, name: "default"})
    const name = atom("Starts with A")
    return {
        createEvaluatorFromTemplate: async () => fake.localId,
        // The evaluator's own name is on its workflow; the revision is named "default".
        queryWorkflows: async () => ({workflows: [{id: "w9", name: "Starts with A"}]}),
        workflowMolecule: {selectors: {data: () => data, artifactName: () => name}},
    }
})
vi.mock("@/features/evaluators/create/EvaluatorTemplatePicker", () => ({
    EvaluatorTemplatePicker: ({onPick}: {onPick: (template: {key: string}) => void}) =>
        createElement("button", {onClick: () => onPick({key: "auto_regex_test"})}, "Pick"),
}))
vi.mock("@/features/evaluators/create/EvaluatorEditorDrawer", () => ({
    EvaluatorEditorDrawer: ({
        revisionId,
        onSaved,
    }: {
        revisionId: string
        onSaved: (id: string) => void
    }) =>
        createElement(
            "button",
            {"data-revision": revisionId, onClick: () => onSaved("w9-r1")},
            "Create in drawer",
        ),
}))
vi.mock("@/features/evaluators/human/HumanEvaluatorSheet", () => ({
    HumanEvaluatorSheet: ({onSaved}: {onSaved: (created: unknown) => void}) =>
        createElement(
            "form",
            {onSubmit: (event: Event) => event.preventDefault()},
            createElement(
                "button",
                {
                    onClick: () =>
                        onSaved({
                            slug: "tone",
                            name: "Tone",
                            workflowId: "w5",
                            revisionId: "w5-r1",
                            version: 1,
                        }),
                },
                "Save human",
            ),
        ),
}))

let host: HTMLDivElement
let root: Root
const onCreated = vi.fn()
const onClose = vi.fn()

const mount = async (kind: "automatic" | "human") => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store: createStore()},
                createElement(CreateEvaluatorFlow, {kind, onCreated, onClose}),
            ),
        )
    })
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}
const click = async (text: string) => {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === text)
    await act(async () => button?.click())
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
})

describe("CreateEvaluatorFlow", () => {
    it("a submit inside the flow does not submit the host's form around it", async () => {
        const hostSubmit = vi.fn((event: Event) => event.preventDefault())
        await act(async () => {
            root.render(
                createElement(
                    Provider,
                    {store: createStore()},
                    createElement(
                        "form",
                        {onSubmit: hostSubmit},
                        createElement(CreateEvaluatorFlow, {kind: "human", onCreated, onClose}),
                    ),
                ),
            )
        })
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
        const inner = host.querySelector("form form") as HTMLFormElement
        await act(async () => {
            inner.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}))
        })
        expect(hostSubmit).not.toHaveBeenCalled()
    })

    it("human: the form's new evaluator comes back selected", async () => {
        await mount("human")
        await click("Save human")
        expect(onCreated).toHaveBeenCalledWith(
            expect.objectContaining({workflowId: "w5", revisionId: "w5-r1", slug: "tone"}),
        )
    })

    it("automatic: a template opens the drawer on the local evaluator, and Create hands it back", async () => {
        await mount("automatic")
        await click("Pick")
        const drawer = host.querySelector("[data-revision]")
        expect(drawer?.getAttribute("data-revision")).toBe("local-9")
        await click("Create in drawer")
        expect(onCreated).toHaveBeenCalledWith({
            workflowId: "w9",
            revisionId: "w9-r1",
            name: "Starts with A",
            slug: "rev-slug",
            version: 1,
        })
        expect(onClose).toHaveBeenCalled()
    })
})
