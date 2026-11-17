// @vitest-environment jsdom
// The evaluator's test pane in the editable drawer: run on an app's output or on test cases.
import {act, createElement} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => ({
    nodes: [] as {entityId: string; label: string}[],
    connect: vi.fn(),
    disconnect: vi.fn(),
}))

vi.mock("@agenta/playground", async () => {
    const {atom} = await import("jotai")
    const nodes = atom(() => fake.nodes)
    return {
        playgroundController: {selectors: {nodes: () => nodes}},
        evaluatorChainController: {
            actions: {
                connectAppToEvaluator: atom(null, (_get, _set, value: unknown) =>
                    fake.connect(value),
                ),
                disconnectAppFromEvaluator: atom(null, () => fake.disconnect()),
            },
        },
    }
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const name = atom(() => "Starts uppercase")
    return {workflowMolecule: {selectors: {artifactName: () => name}}}
})
vi.mock("@agenta/playground-ui/panels/evaluator", () => ({
    RunOnSelector: ({onPick}: {onPick: (mode: "app" | "data") => void}) =>
        createElement("button", {onClick: () => onPick("data")}, "Run on test cases"),
    AppPicker: ({onSelect}: {onSelect: (app: {id: string; label: string}) => void}) =>
        createElement(
            "button",
            {onClick: () => onSelect({id: "app-r1", label: "Capital finder"})},
            "Select app",
        ),
}))
vi.mock("@/features/playground/PlaygroundRunPane", () => ({
    PlaygroundRunPane: ({revisionId}: {revisionId: string}) =>
        createElement("div", {"data-testid": "runs", "data-revision": revisionId}),
}))
vi.mock("@/features/playground/states/SelectAppEmpty", () => ({
    SelectAppEmpty: () => createElement("div", {"data-testid": "select-app"}),
}))

import {EvaluatorTestPane} from "@/features/evaluators/create/EvaluatorTestPane"

let host: HTMLDivElement
let root: Root

const mount = async () => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store: createStore()},
                createElement(EvaluatorTestPane, {revisionId: "local-1"}),
            ),
        )
    })
}
const button = (text: string) =>
    [...host.querySelectorAll("button")].find((item) => item.textContent === text)

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    fake.nodes = [{entityId: "local-1", label: "Evaluator"}]
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
})

describe("EvaluatorTestPane", () => {
    it("asks for an app first, then connects the picked app to the evaluator", async () => {
        await mount()
        expect(host.querySelector('[data-testid="select-app"]')).not.toBeNull()
        await act(async () => button("Select app")?.click())
        expect(fake.connect).toHaveBeenCalledWith({
            appRevisionId: "app-r1",
            appLabel: "Capital finder",
            evaluatorRevisionId: "local-1",
            evaluatorLabel: "Starts uppercase",
        })
    })

    it("runs the test cases through the connected app", async () => {
        fake.nodes = [
            {entityId: "app-r1", label: "Capital finder"},
            {entityId: "local-1", label: "Evaluator"},
        ]
        await mount()
        expect(host.querySelector('[data-testid="runs"]')?.getAttribute("data-revision")).toBe(
            "app-r1",
        )
    })

    it("running on test cases drops the app and runs the evaluator itself", async () => {
        await mount()
        await act(async () => button("Run on test cases")?.click())
        expect(fake.disconnect).toHaveBeenCalled()
        expect(host.querySelector('[data-testid="runs"]')?.getAttribute("data-revision")).toBe(
            "local-1",
        )
    })
})
