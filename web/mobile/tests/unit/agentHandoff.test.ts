import {describe, expect, it} from "vitest"

import {agentHandoffPath} from "../../src/features/agents/agentHandoff"

const base = "/w/ws-1/p/proj-1"

describe("agentHandoffPath", () => {
    it("opens the chat for a seeded create, carrying the agent", () => {
        // A session with no turns cannot name its agent from records, hence `?agent=`.
        expect(agentHandoffPath({base, appId: "app-1", sessionId: "session-1"})).toBe(
            "/w/ws-1/p/proj-1/sessions/session-1?agent=app-1",
        )
    })

    it("opens the agent's overview for a blank create", () => {
        expect(agentHandoffPath({base, appId: "app-1", sessionId: null})).toBe(
            "/w/ws-1/p/proj-1/agents/app-1",
        )
    })
})
