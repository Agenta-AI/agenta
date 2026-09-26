import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    agentTemplateLookupAtomFamily,
    agentTemplatesAtom,
    agentTemplatesStatusAtom,
} from "../../src/workflow/state/agentTemplateCatalog"

import {CATALOG_QUERY_RESPONSE, FIXTURE_TEMPLATES} from "./agentTemplateFixtures"

const {queryAgentTemplates} = vi.hoisted(() => ({queryAgentTemplates: vi.fn()}))

vi.mock("../../src/workflow/api/agentTemplates", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/workflow/api/agentTemplates")>()
    return {...actual, queryAgentTemplates}
})

const makeStore = () => {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(sessionAtom, true)
    store.set(projectIdAtom, "proj-1")
    return store
}

const settle = async (store: ReturnType<typeof makeStore>) => {
    store.sub(agentTemplatesStatusAtom, () => undefined)
    await vi.waitFor(() => expect(store.get(agentTemplatesStatusAtom)).not.toBe("pending"))
}

describe("agent template catalog atoms", () => {
    beforeEach(() => {
        queryAgentTemplates.mockReset()
    })

    it("serves the API catalog as cards, scoped to the project", async () => {
        queryAgentTemplates.mockResolvedValue(CATALOG_QUERY_RESPONSE)
        const store = makeStore()

        await settle(store)

        expect(store.get(agentTemplatesStatusAtom)).toBe("success")
        expect(store.get(agentTemplatesAtom)).toEqual(FIXTURE_TEMPLATES)
        expect(queryAgentTemplates).toHaveBeenCalledWith("proj-1")
    })

    it("never reports a key missing while the catalog is loading", () => {
        queryAgentTemplates.mockReturnValue(new Promise(() => undefined))
        const store = makeStore()
        store.sub(agentTemplatesStatusAtom, () => undefined)

        expect(store.get(agentTemplateLookupAtomFamily("pr-reviewer"))).toEqual({
            status: "pending",
        })
        expect(store.get(agentTemplatesAtom)).toEqual([])
    })

    it("reports a failed read as an error, not an empty catalog or a missing key", async () => {
        queryAgentTemplates.mockRejectedValue(new Error("unavailable"))
        const store = makeStore()

        await settle(store)

        expect(store.get(agentTemplatesStatusAtom)).toBe("error")
        expect(store.get(agentTemplateLookupAtomFamily("pr-reviewer"))).toEqual({
            status: "error",
        })
    })

    it("finds a catalog key and confirms an absent one only after loading", async () => {
        queryAgentTemplates.mockResolvedValue(CATALOG_QUERY_RESPONSE)
        const store = makeStore()

        await settle(store)

        const found = store.get(agentTemplateLookupAtomFamily("pr-reviewer"))
        expect(found.status).toBe("found")
        expect(found.template?.name).toBe("PR reviewer")
        expect(store.get(agentTemplateLookupAtomFamily("not-in-this-release"))).toEqual({
            status: "missing",
        })
    })

    it("does not fetch without a project", () => {
        const store = createStore()
        store.set(queryClientAtom, new QueryClient())
        store.set(sessionAtom, true)
        store.sub(agentTemplatesStatusAtom, () => undefined)

        expect(store.get(agentTemplatesStatusAtom)).toBe("pending")
        expect(queryAgentTemplates).not.toHaveBeenCalled()
    })
})
