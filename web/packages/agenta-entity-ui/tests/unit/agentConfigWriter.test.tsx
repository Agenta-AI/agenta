/**
 * The agent config writer: it writes `parameters.agent` of the revision on screen, reading the
 * latest configuration at write time, and an open view follows the revision auto-save puts in
 * place of the one it opened on.
 */
import {act, createElement} from "react"

import {atom, createStore, Provider, type PrimitiveAtom, type WritableAtom} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    followRevision,
    revisionSuccessorsAtom,
    useAgentConfigWriter,
    type AgentConfigWriter,
} from "../../src/DrillInView/SchemaControls/agentTemplate/useAgentConfigWriter"

const {configs} = vi.hoisted(() => ({
    configs: {} as Record<string, unknown>,
}))

vi.mock("@agenta/entities/workflow", async () => {
    const {atom: makeAtom} = await import("jotai")
    const byId = new Map<string, PrimitiveAtom<unknown>>()
    const configuration = (id: string) => {
        if (!byId.has(id)) byId.set(id, makeAtom(configs[id] ?? null))
        return byId.get(id)!
    }
    const updateConfiguration = makeAtom(null, (_get, set, id: string, params: unknown) =>
        set(configuration(id), params),
    )
    return {workflowMolecule: {selectors: {configuration}, actions: {updateConfiguration}}}
})

vi.mock("../../src/DrillInView/components/PlaygroundConfigSection/atoms", () => ({
    moleculeSchemaAtPath: () => atom(null),
}))

let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
let writer: AgentConfigWriter
let store: ReturnType<typeof createStore>

const Probe = ({revisionId}: {revisionId: string}) => {
    writer = useAgentConfigWriter(revisionId)
    return null
}

const mount = async (revisionId: string) => {
    await act(async () =>
        root.render(createElement(Provider, {store}, createElement(Probe, {revisionId}))),
    )
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    configs["rev-1"] = {agent: {instructions: {agents_md: "old"}}, other: 1}
    configs["rev-2"] = {agent: {instructions: {agents_md: "saved"}, tools: [1]}, other: 2}
    store = createStore()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
})

describe("useAgentConfigWriter", () => {
    it("writes parameters.agent and keeps the other parameters", async () => {
        await mount("rev-1")
        await act(async () => writer.update((agent) => ({...agent, llm: {model: "m"}})))
        expect(writer.agent).toEqual({instructions: {agents_md: "old"}, llm: {model: "m"}})
        await act(async () => writer.update((agent) => ({...agent, tools: []})))
        // The second write starts from the first one.
        expect(writer.agent).toEqual({
            instructions: {agents_md: "old"},
            llm: {model: "m"},
            tools: [],
        })
    })

    it("follows the revision that replaced the one the view opened on", async () => {
        await mount("rev-1")
        await act(async () =>
            store.set(revisionSuccessorsAtom as WritableAtom<unknown, [unknown], void>, {
                "rev-1": "rev-2",
            }),
        )
        expect(writer.revisionId).toBe("rev-2")
        await act(async () => writer.update((agent) => ({...agent, llm: {model: "m"}})))
        expect(writer.agent).toEqual({
            instructions: {agents_md: "saved"},
            tools: [1],
            llm: {model: "m"},
        })
    })
})

describe("followRevision", () => {
    it("follows a chain and stops on a loop", () => {
        expect(followRevision({a: "b", b: "c"}, "a")).toBe("c")
        expect(followRevision({a: "b", b: "a"}, "a")).toBe("a")
        expect(followRevision({}, "a")).toBe("a")
    })
})
