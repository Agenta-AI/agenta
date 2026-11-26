// @vitest-environment jsdom
// Create new evaluator from the app playground's evaluator picker (beta developer mode only).
import {act, createElement} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundEvaluatorPicker} from "@/features/evaluators/create/PlaygroundEvaluatorPicker"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => ({
    beta: false,
    onCreateNew: undefined as undefined | (() => void),
    flowProps: null as null | Record<string, unknown>,
    connect: vi.fn(),
}))

vi.mock("@agenta/shared/state", async () => {
    const {atom} = await import("jotai")
    return {betaDeveloperModeActiveAtom: atom(() => fake.beta)}
})
vi.mock("@agenta/playground", async () => {
    const {atom} = await import("jotai")
    const nodes = atom([
        {id: "n-app", entityId: "app-r1", depth: 0},
        {id: "n-eval", entityId: "eval-r1", depth: 1},
    ])
    return {
        playgroundController: {
            selectors: {nodes: () => nodes},
            actions: {
                connectDownstreamNode: atom(null, (_get, _set, value: unknown) =>
                    fake.connect(value),
                ),
            },
        },
    }
})
vi.mock("@agenta/playground-ui/panels/evaluator", () => ({
    EvaluatorPicker: ({onCreateNew}: {onCreateNew?: () => void}) => {
        fake.onCreateNew = onCreateNew
        return null
    },
}))
// The flow is a separate chunk: a stand-in that "creates" Starts with A at once.
vi.mock("next/dynamic", () => ({
    default: () => (props: Record<string, unknown>) => {
        fake.flowProps = props
        const onCreated = props.onCreated as (created: Record<string, unknown>) => void
        return createElement(
            "button",
            {
                onClick: () =>
                    onCreated({
                        workflowId: "w9",
                        revisionId: "w9-r1",
                        name: "Starts with A",
                        slug: "s",
                        version: 1,
                    }),
            },
            "Save new evaluator",
        )
    },
}))

let host: HTMLDivElement
let root: Root
const mount = async () => {
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store: createStore()},
                createElement(PlaygroundEvaluatorPicker),
            ),
        )
    })
}

beforeEach(() => {
    fake.beta = false
    fake.onCreateNew = undefined
    fake.flowProps = null
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
})

describe("PlaygroundEvaluatorPicker", () => {
    it("offers no create without beta developer mode", async () => {
        await mount()
        expect(fake.onCreateNew).toBeUndefined()
    })

    it("creates with the drawer off the playground and runs the new evaluator after the app", async () => {
        fake.beta = true
        await mount()
        await act(async () => fake.onCreateNew?.())
        expect(fake.flowProps).toMatchObject({kind: "automatic", onPlayground: true})
        const save = [...host.querySelectorAll("button")].find(
            (button) => button.textContent === "Save new evaluator",
        )
        await act(async () => save?.click())
        expect(fake.connect).toHaveBeenCalledWith({
            sourceNodeId: "n-app",
            entity: {type: "workflow", id: "w9-r1", label: "Starts with A"},
        })
    })
})
