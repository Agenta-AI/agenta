import {afterEach, describe, expect, it, vi} from "vitest"

import {analyticsIdentity, captureFirstAgentIntent, classifyAgentIntent} from "../../src/analytics"

afterEach(() => vi.unstubAllGlobals())

describe("shared desktop and mobile analytics", () => {
    it("identifies by the backend user id and keeps email as a property", () => {
        const user = {
            id: "user-1",
            email: "test@agenta.ai",
            username: "test",
            instance_id: "instance-1",
        }
        expect(analyticsIdentity(user)).toEqual({
            id: "user-1",
            properties: {email: "test@agenta.ai", username: "test"},
            instanceId: "instance-1",
        })
    })

    it("stays anonymous until the profile has a user id", () => {
        expect(analyticsIdentity(null)).toEqual({
            id: null,
            properties: undefined,
            instanceId: null,
        })
        expect(analyticsIdentity({email: "test@agenta.ai"}).id).toBeNull()
    })

    it("classifies text without sending it as an event property", () => {
        const capture = vi.fn()
        captureFirstAgentIntent(
            {capture},
            {
                source: "composer",
                intentValue: classifyAgentIntent("Research my private customer list"),
            },
        )
        expect(capture).toHaveBeenCalledWith("first_agent_intent", {
            source: "composer",
            $set: {first_agent_intent_v1: "support"},
        })
        expect(JSON.stringify(capture.mock.calls)).not.toContain("private customer list")
    })

    it("preserves template metadata and makes analytics failures harmless", () => {
        const capture = vi.fn()
        captureFirstAgentIntent(
            {capture},
            {source: "template", properties: {templateId: "research"}, intentValue: "research"},
        )
        expect(capture).toHaveBeenCalledWith("first_agent_intent", {
            source: "template",
            templateId: "research",
            $set: {first_agent_intent_v1: "research"},
        })
        expect(() =>
            captureFirstAgentIntent(
                {
                    capture: () => {
                        throw new Error("blocked")
                    },
                },
                {source: "skipped"},
            ),
        ).not.toThrow()
    })
})
