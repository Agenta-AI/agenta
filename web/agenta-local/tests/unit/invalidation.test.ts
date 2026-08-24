import {queryClient} from "@agenta/shared/api"
import {afterEach, describe, expect, it, vi} from "vitest"

import {localApi} from "@/lib/api/client"
import {agentKeys, commitAgentRevision, createAgent, deleteAgent} from "@/lib/state/agents"
import {providerKeys, removeProvider, saveProvider} from "@/lib/state/providers"
import {createSession, sessionKeys, streamTurn} from "@/lib/state/sessions"

const revision = {
    id: "rev_1",
    version: 1,
    instructions: "Be useful",
    model: {provider: "openai", name: "gpt-4o-mini", parameters: {}},
    execution: {harness: "pi_core", sandbox: "local"},
}
const agent = {
    id: "agt_1",
    name: "Helper",
    current_revision: revision,
    created_at: "now",
    updated_at: "now",
}
const session = {
    id: "ses_1",
    agent_revision_id: "rev_1",
    title: null,
    status: "active",
    created_at: "now",
    updated_at: "now",
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status})

afterEach(() => {
    queryClient.clear()
    vi.unstubAllGlobals()
})

const seedList = (key: readonly unknown[], data: unknown) =>
    queryClient.setQueryData([...key], data)

describe("query invalidation wiring", () => {
    it("createAgent seeds the detail cache and invalidates the list", async () => {
        seedList(agentKeys.all, [agent])
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(jsonResponse({...agent, id: "agt_2"}, 201)),
        )
        const created = await createAgent({
            name: "New",
            instructions: "x",
            model: {provider: "openai", name: "gpt-4o-mini", parameters: {}},
        })
        expect(created.id).toBe("agt_2")
        expect(queryClient.getQueryState(agentKeys.all)?.isInvalidated).toBe(true)
        expect(queryClient.getQueryData(agentKeys.detail("agt_2"))).toMatchObject({id: "agt_2"})
    })

    it("commitAgentRevision invalidates list and detail", async () => {
        seedList(agentKeys.all, [agent])
        seedList(agentKeys.detail("agt_1"), agent)
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(jsonResponse({...revision, version: 2}, 201)),
        )
        const next = await commitAgentRevision("agt_1", {
            instructions: "Sharper",
            model: {provider: "openai", name: "gpt-4o-mini", parameters: {}},
        })
        expect(next.version).toBe(2)
        expect(queryClient.getQueryState(agentKeys.all)?.isInvalidated).toBe(true)
        expect(queryClient.getQueryState(agentKeys.detail("agt_1"))?.isInvalidated).toBe(true)
    })

    it("deleteAgent drops the detail cache and invalidates the list", async () => {
        seedList(agentKeys.all, [agent])
        queryClient.setQueryData(agentKeys.detail("agt_1"), agent)
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 204})))
        await deleteAgent("agt_1")
        expect(queryClient.getQueryData(agentKeys.detail("agt_1"))).toBeUndefined()
        expect(queryClient.getQueryState(agentKeys.all)?.isInvalidated).toBe(true)
    })

    it("provider save/remove invalidate the provider states", async () => {
        seedList(providerKeys.all, [{provider: "openai", configured: true, key_suffix: "1234"}])
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 204})))
        await saveProvider("anthropic", {credentials: {api_key: "sk"}})
        expect(queryClient.getQueryState(providerKeys.all)?.isInvalidated).toBe(true)
        queryClient.setQueryData(providerKeys.all, [])
        await removeProvider("openai")
        expect(queryClient.getQueryState(providerKeys.all)?.isInvalidated).toBe(true)
    })

    it("createSession seeds the empty conversation and invalidates the list", async () => {
        seedList(sessionKeys.all, [])
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(session, 201)))
        const created = await createSession("rev_1")
        expect(created.id).toBe("ses_1")
        expect(queryClient.getQueryData(sessionKeys.detail("ses_1"))).toMatchObject({messages: []})
        expect(queryClient.getQueryState(sessionKeys.all)?.isInvalidated).toBe(true)
    })

    it("a streamed turn invalidates session caches after the terminal frame", async () => {
        seedList(sessionKeys.all, [session])
        seedList(sessionKeys.detail("ses_1"), {...session, messages: []})
        const body = [
            `data: ${JSON.stringify({type: "text-delta", id: "t1", delta: "Hi"})}\n\n`,
            `data: ${JSON.stringify({type: "finish"})}\n\n`,
        ].join("")
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(body, {
                    status: 200,
                    headers: {"Content-Type": "text/event-stream"},
                }),
            ),
        )
        for await (const _frame of streamTurn(
            "ses_1",
            "hello",
            "turn_1",
            new AbortController().signal,
        )) {
            void _frame
        }
        expect(queryClient.getQueryState(sessionKeys.all)?.isInvalidated).toBe(true)
        expect(queryClient.getQueryState(sessionKeys.detail("ses_1"))?.isInvalidated).toBe(true)
    })

    it("keeps the shared QueryClient singleton reachable through the same origin client", () => {
        expect(typeof localApi.listAgents).toBe("function")
        expect(queryClient.getDefaultOptions()).toBeDefined()
    })
})
