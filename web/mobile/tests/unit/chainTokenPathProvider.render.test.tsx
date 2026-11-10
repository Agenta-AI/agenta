// @vitest-environment jsdom
// The evaluator's `{{$.…}}` typeahead provider keeps one element tree when an app connects:
// switching wrappers would remount the editable drawer below it and reset its playground state.
import {act, createElement, useEffect} from "react"

import * as playground from "@agenta/playground"
import {useTokenPathSuggestions} from "@agenta/ui/editor"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// The file itself: the panel barrel pulls in pickers this test does not need. Mocks are hoisted.
import {ChainTokenPathProvider} from "../../../packages/agenta-playground-ui/src/panels/evaluator/ChainTokenPathProvider"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const fake = vi.hoisted(() => ({
    nodes: [] as {id: string; entityId: string}[],
    connections: [] as {sourceNodeId: string; targetNodeId: string}[],
}))

vi.mock("@agenta/playground", async () => {
    const {atom} = await import("jotai")
    const tick = atom(0)
    const nodes = atom((get) => (get(tick), fake.nodes))
    const connections = atom((get) => (get(tick), fake.connections))
    return {
        __tick: tick,
        playgroundController: {selectors: {nodes: () => nodes}},
        outputConnectionController: {selectors: {allConnections: () => connections}},
    }
})
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const ports = atom([{key: "country"}])
    return {workflowMolecule: {selectors: {inputPorts: () => ports, outputPorts: () => ports}}}
})

const mounts = vi.fn()
const seen = vi.fn()
const Child = () => {
    const getter = useTokenPathSuggestions()
    useEffect(() => mounts(), [])
    seen(Boolean(getter))
    return null
}

let host: HTMLDivElement
let root: Root
const store = createStore()
const tickAtom = (playground as unknown as {__tick: PrimitiveAtom<number>}).__tick

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    fake.nodes = [{id: "n-eval", entityId: "local-1"}]
    fake.connections = []
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.clearAllMocks()
})

describe("ChainTokenPathProvider", () => {
    it("connecting an app gives the editors suggestions without remounting them", async () => {
        await act(async () => {
            root.render(
                createElement(
                    Provider,
                    {store},
                    createElement(ChainTokenPathProvider, {
                        entityId: "local-1",
                        children: createElement(Child),
                    }),
                ),
            )
        })
        expect(seen).toHaveBeenLastCalledWith(false)

        fake.nodes = [
            {id: "n-app", entityId: "app-r1"},
            {id: "n-eval", entityId: "local-1"},
        ]
        fake.connections = [{sourceNodeId: "n-app", targetNodeId: "n-eval"}]
        await act(async () => {
            store.set(tickAtom, 1)
        })

        expect(seen).toHaveBeenLastCalledWith(true)
        expect(mounts).toHaveBeenCalledTimes(1)
    })
})
