/**
 * An agent whose `drives` list omits its own drive has no agent drive: the lookup answers no
 * mount, and the files pane must read that as "no agent drive", not as a failure to retry.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fern = vi.hoisted(() => ({queryAgentMount: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getMountsClient: () => fern,
    getLowPriorityMountsClient: () => fern,
    getSessionsClient: () => ({}),
    getLowPrioritySessionsClient: () => ({}),
}))

import {agentMountQueryFamily} from "../../src/drive/agentDrive"

async function settle(artifactId: string) {
    const store = createStore()
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "p1")
    const target = agentMountQueryFamily(artifactId)
    const unsub = store.sub(target, () => undefined)
    await vi.waitFor(() => expect(store.get(target).isPending).toBe(false))
    const value = store.get(target)
    unsub()
    return value
}

beforeEach(() => {
    fern.queryAgentMount.mockReset()
})

describe("agentMountQueryFamily", () => {
    it("answers null, not an error, for an agent with no agent drive", async () => {
        fern.queryAgentMount.mockResolvedValue({count: 0, mounts: []})
        const q = await settle("a-none")
        expect(q.isError).toBe(false)
        expect(q.data).toBeNull()
    })

    it("answers the mount when the agent has one", async () => {
        fern.queryAgentMount.mockResolvedValue({count: 1, mounts: [{id: "m1", slug: "s"}]})
        const q = await settle("a-one")
        expect(q.data).toEqual({id: "m1", slug: "s"})
    })

    it("is an error when the lookup fails", async () => {
        fern.queryAgentMount.mockRejectedValue(new Error("boom"))
        const q = await settle("a-fail")
        expect(q.isError).toBe(true)
    })
})
