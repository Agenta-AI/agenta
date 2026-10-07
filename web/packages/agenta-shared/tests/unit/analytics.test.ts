import {afterEach, describe, expect, it, vi} from "vitest"

import {
    analyticsIdentity,
    captureFirstAgentIntent,
    classifyAgentIntent,
    generateOrRetrieveDistinctId,
} from "../../src/analytics"

afterEach(() => vi.unstubAllGlobals())

describe("shared desktop and mobile analytics", () => {
    it("reads the existing desktop visitor ID", () => {
        vi.stubGlobal("localStorage", {getItem: () => "existing-desktop-id"})
        expect(generateOrRetrieveDistinctId()).toBe("existing-desktop-id")
    })

    it("stores a new visitor ID under the same key", () => {
        const setItem = vi.fn()
        vi.stubGlobal("localStorage", {getItem: () => null, setItem})
        const id = generateOrRetrieveDistinctId()
        expect(setItem).toHaveBeenCalledWith("posthog_distinct_id", id)
        expect(id).toMatch(/^[a-f0-9-]{36}$/)
    })

    it("survives unavailable browser storage with a stable in-memory ID", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("denied")
            },
        })
        expect(generateOrRetrieveDistinctId()).toBe(generateOrRetrieveDistinctId())
    })

    it("uses email on cloud, the visitor ID on OSS, and preserves person properties", () => {
        const user = {email: "person@example.test", username: "Person"}
        expect(analyticsIdentity(user, true, "visitor")).toEqual({id: user.email, properties: user})
        expect(analyticsIdentity(user, false, "visitor")).toEqual({id: "visitor", properties: user})
        expect(analyticsIdentity(null, true, "visitor")).toEqual({
            id: "visitor",
            properties: undefined,
        })
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
