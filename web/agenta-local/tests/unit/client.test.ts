import {afterEach, describe, expect, it, vi} from "vitest"

import {localApi} from "@/lib/api/client"
import {
    agentRevisionSchema,
    agentSchema,
    agentsSchema,
    healthSchema,
    providerStatesSchema,
    runtimeSchema,
    sessionDetailSchema,
    sessionSchema,
    sessionsSchema,
    shutdownSchema,
    stopSchema,
} from "@/lib/api/schemas"

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

afterEach(() => vi.unstubAllGlobals())

describe("local API client", () => {
    it("uses same-origin credentials and validates the response", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(new Response(JSON.stringify([agent]), {status: 200}))
        vi.stubGlobal("fetch", fetchMock)
        await expect(localApi.listAgents()).resolves.toEqual([agent])
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/agents",
            expect.objectContaining({credentials: "same-origin"}),
        )
    })

    it("maps the stable service error shape", async () => {
        vi.stubGlobal(
            "fetch",
            vi
                .fn()
                .mockResolvedValue(
                    new Response(
                        JSON.stringify({code: "session_busy", message: "busy", retryable: true}),
                        {status: 409},
                    ),
                ),
        )
        await expect(localApi.listSessions()).rejects.toMatchObject({
            code: "session_busy",
            status: 409,
            retryable: true,
        })
    })

    it("rejects malformed successful responses", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response(JSON.stringify({secret: "bad"}), {status: 200})),
        )
        await expect(localApi.listProviders()).rejects.toMatchObject({code: "invalid_response"})
    })

    it("sends JSON content-type on bodyless mutations (stop, shutdown)", async () => {
        const fetchMock = vi.fn()
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({stopped: true}), {status: 200}),
        )
        fetchMock.mockResolvedValueOnce(
            new Response(JSON.stringify({stopping: true}), {status: 202}),
        )
        vi.stubGlobal("fetch", fetchMock)
        await localApi.stopSession("ses_1")
        await localApi.shutdown()
        const [, stopInit] = fetchMock.mock.calls[0]
        const [, shutdownInit] = fetchMock.mock.calls[1]
        expect(stopInit.headers).toMatchObject({"Content-Type": "application/json"})
        expect(shutdownInit.headers).toMatchObject({"Content-Type": "application/json"})
    })

    it("encodes path parameters and the turn envelope", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(`data: ${JSON.stringify({type: "finish"})}\n\n`, {
                status: 200,
                headers: {"Content-Type": "text/event-stream"},
            }),
        )
        vi.stubGlobal("fetch", fetchMock)
        await localApi.turnRequest(
            "ses x/1",
            {text: "hello", clientTurnId: "turn_1"},
            new AbortController().signal,
        )
        const [path, init] = fetchMock.mock.calls[0]
        expect(path).toBe("/api/sessions/ses%20x%2F1/turns")
        expect(init.body).toBe(
            JSON.stringify({
                input: {content: [{type: "text", text: "hello"}]},
                context: {client_turn_id: "turn_1"},
            }),
        )
    })

    it("defines a Zod boundary for every JSON response", () => {
        expect(agentsSchema.parse([agent])).toHaveLength(1)
        expect(agentSchema.parse(agent).id).toBe("agt_1")
        expect(agentRevisionSchema.parse(revision).version).toBe(1)
        expect(
            providerStatesSchema.parse([
                {provider: "openai", configured: true, key_suffix: "1234"},
            ]),
        ).toHaveLength(1)
        expect(sessionsSchema.parse([session])).toHaveLength(1)
        expect(sessionSchema.parse(session).status).toBe("active")
        expect(sessionDetailSchema.parse({...session, messages: []}).messages).toEqual([])
        expect(stopSchema.parse({stopped: true}).stopped).toBe(true)
        expect(shutdownSchema.parse({stopping: true}).stopping).toBe(true)
        expect(runtimeSchema.parse({runner: {ok: true}, version: "1"}).runner.ok).toBe(true)
        expect(
            healthSchema.parse({ok: true, version: "1", schema_version: 1, recovered_turns: 0}).ok,
        ).toBe(true)
    })
})
