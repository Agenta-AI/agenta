import {describe, expect, it} from "vitest"

import {
    appendCapped,
    buildTurnCapture,
    capturesForTrigger,
    triggerUserMessageId,
} from "../../src/state/execution/turnCapture"

describe("turnCapture", () => {
    it("finds the last user message id as the trigger", () => {
        const messages = [
            {id: "u1", role: "user"},
            {id: "a1", role: "assistant"},
            {id: "u2", role: "user"},
            {id: "a2", role: "assistant"},
        ]
        expect(triggerUserMessageId(messages)).toBe("u2")
    })

    it("returns null when there is no user message", () => {
        expect(triggerUserMessageId([{id: "a1", role: "assistant"}])).toBeNull()
    })

    it("builds a capture from a built AgentRequest", () => {
        const req = {
            invocationUrl: "https://x/invoke?project_id=p",
            requestBody: {
                session_id: "s1",
                references: {application: {id: "app"}},
                data: {
                    inputs: {messages: [{id: "u1", role: "user"}]},
                    parameters: {agent: {instructions: {agents_md: "hi"}}},
                },
            },
        }
        const c = buildTurnCapture(req, "req-1", 1000)
        expect(c).toEqual({
            requestId: "req-1",
            at: 1000,
            triggerUserMessageId: "u1",
            parameters: {agent: {instructions: {agents_md: "hi"}}},
            messages: [{id: "u1", role: "user"}],
            references: {application: {id: "app"}},
            sessionId: "s1",
            invocationUrl: "https://x/invoke?project_id=p",
        })
    })

    it("groups all sends of a turn under one trigger id", () => {
        const base = {
            parameters: {},
            messages: [],
            references: null,
            sessionId: "s",
            invocationUrl: "u",
        }
        const captures = [
            {...base, requestId: "r1", at: 1, triggerUserMessageId: "u1"},
            {...base, requestId: "r2", at: 2, triggerUserMessageId: "u1"},
            {...base, requestId: "r3", at: 3, triggerUserMessageId: "u2"},
        ]
        expect(capturesForTrigger(captures, "u1").map((c) => c.requestId)).toEqual(["r1", "r2"])
        expect(capturesForTrigger(captures, null)).toEqual([])
    })

    it("evicts the oldest whole turns beyond the cap, keeping all sends of kept turns", () => {
        const base = {
            parameters: {},
            messages: [],
            references: null,
            sessionId: "s",
            invocationUrl: "u",
        }
        let list: ReturnType<typeof capturesForTrigger> = []
        list = appendCapped(list, {...base, requestId: "r1", at: 1, triggerUserMessageId: "u1"}, 2)
        list = appendCapped(list, {...base, requestId: "r1b", at: 2, triggerUserMessageId: "u1"}, 2)
        list = appendCapped(list, {...base, requestId: "r2", at: 3, triggerUserMessageId: "u2"}, 2)
        list = appendCapped(list, {...base, requestId: "r3", at: 4, triggerUserMessageId: "u3"}, 2)
        // u1 (oldest turn) evicted; both u1 sends gone; u2 + u3 kept.
        expect(list.map((c) => c.triggerUserMessageId)).toEqual(["u2", "u3"])
    })
})
