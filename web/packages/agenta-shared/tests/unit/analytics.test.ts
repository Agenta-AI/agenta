import {afterEach, describe, expect, it, vi} from "vitest"

import {
    analyticsIdentity,
    captureFirstAgentIntent,
    classifyAgentIntent,
    generateOrRetrieveDistinctId,
    isCloudTelemetry,
    parseInstanceTelemetry,
    stripInstanceUrl,
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

    it("uses email and person properties on cloud, and the API's id alone when self-hosted", () => {
        const user = {email: "person@example.test", username: "Person"}
        expect(analyticsIdentity(user, true, "visitor")).toEqual({id: user.email, properties: user})
        expect(analyticsIdentity(user, false, "instance:user")).toEqual({
            id: "instance:user",
            properties: undefined,
        })
        expect(analyticsIdentity(null, true, "visitor")).toEqual({
            id: "visitor",
            properties: undefined,
        })
    })

    it("removes every address and referrer posthog-js adds on a self-hosted event", () => {
        const event = {
            event: "$pageview",
            properties: {
                $current_url: "https://agenta.internal/m/w/1",
                $host: "agenta.internal",
                $referrer: "https://intranet.internal/",
                $referring_domain: "intranet.internal",
                $session_entry_url: "https://agenta.internal/m",
                $session_entry_host: "agenta.internal",
                $session_entry_referrer: "https://intranet.internal/",
                $session_entry_referring_domain: "intranet.internal",
                $pathname: "/m/w/1",
                $browser: "Chrome",
            },
            $set: {$current_url: "https://agenta.internal/m"},
            $set_once: {
                $initial_person_info: {r: "https://intranet.internal/", u: "https://agenta.internal/m"},
                $initial_current_url: "https://agenta.internal/m",
            },
        }
        const sent = stripInstanceUrl(event)
        expect(JSON.stringify(sent)).not.toContain("internal")
        expect(sent?.properties).toEqual({$pathname: "/m/w/1", $browser: "Chrome", $geoip_disable: true})
    })

    it("answers cloud only when telemetry is on and names no instance group", () => {
        expect(isCloudTelemetry(parseInstanceTelemetry({enabled: true, distinct_id: "a@b.c", groups: null}))).toBe(true)
        expect(
            isCloudTelemetry(
                parseInstanceTelemetry({enabled: true, distinct_id: "i:u", groups: {instance: "i"}}),
            ),
        ).toBe(false)
        expect(isCloudTelemetry(parseInstanceTelemetry({enabled: false, distinct_id: null, groups: null}))).toBe(false)
        expect(parseInstanceTelemetry(undefined)).toEqual({enabled: false, distinct_id: null, groups: null})
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
