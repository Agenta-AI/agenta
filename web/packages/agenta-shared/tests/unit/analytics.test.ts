import {afterEach, describe, expect, it, vi} from "vitest"

import {
    adoptInstanceIdentity,
    analyticsPersonProperties,
    captureFirstAgentIntent,
    classifyAgentIntent,
    isCloudTelemetry,
    parseInstanceTelemetry,
    stripInstanceUrl,
} from "../../src/analytics"

afterEach(() => vi.unstubAllGlobals())

describe("shared desktop and mobile analytics", () => {
    it("sends email and username as person properties on cloud only", () => {
        const user = {email: "person@example.test", username: "Person"}
        expect(analyticsPersonProperties(user, true)).toEqual(user)
        expect(analyticsPersonProperties(user, false)).toBeUndefined()
        expect(analyticsPersonProperties(null, true)).toBeUndefined()
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
                $initial_person_info: {
                    r: "https://intranet.internal/",
                    u: "https://agenta.internal/m",
                },
                $initial_current_url: "https://agenta.internal/m",
            },
        }
        const sent = stripInstanceUrl(event)
        expect(JSON.stringify(sent)).not.toContain("internal")
        expect(sent?.properties).toEqual({
            $pathname: "/m/w/1",
            $browser: "Chrome",
            $geoip_disable: true,
        })
    })

    it("answers cloud only when telemetry is on and names no instance group", () => {
        expect(
            isCloudTelemetry(
                parseInstanceTelemetry({enabled: true, distinct_id: "a@b.c", groups: null}),
            ),
        ).toBe(true)
        expect(
            isCloudTelemetry(
                parseInstanceTelemetry({
                    enabled: true,
                    distinct_id: "i:u",
                    groups: {instance: "i"},
                }),
            ),
        ).toBe(false)
        expect(
            isCloudTelemetry(
                parseInstanceTelemetry({enabled: false, distinct_id: null, groups: null}),
            ),
        ).toBe(false)
        expect(parseInstanceTelemetry(undefined)).toEqual({
            enabled: false,
            distinct_id: null,
            groups: null,
            properties: null,
        })
    })

    it("reads the cloud event properties and drops values that are not text", () => {
        expect(
            parseInstanceTelemetry({
                enabled: true,
                distinct_id: "user-1",
                groups: null,
                properties: {cloud_region: "EU", cloud_url: "https://eu.cloud.agenta.ai", n: 1},
            }).properties,
        ).toEqual({cloud_region: "EU", cloud_url: "https://eu.cloud.agenta.ai"})
    })

    const recordingClient = (distinctId: string) => {
        const calls: string[] = []
        const client = {
            get_distinct_id: () => distinctId,
            reset: () => calls.push("reset"),
            identify: (id: string, properties?: Record<string, unknown>) =>
                calls.push(`identify ${id}${properties ? ` ${JSON.stringify(properties)}` : ""}`),
            group: (type: string, key: string) => calls.push(`group ${type} ${key}`),
            register: (properties: Record<string, string>) =>
                calls.push(`register ${JSON.stringify(properties)}`),
        }
        return {client, calls}
    }

    it("starts over before it identifies a browser that holds another id", () => {
        const {client, calls} = recordingClient("person@example.test")
        adoptInstanceIdentity(client, {
            enabled: true,
            distinct_id: "instance-1:user-1",
            groups: {instance: "instance-1"},
            properties: null,
        })
        expect(calls).toEqual(["reset", "identify instance-1:user-1", "group instance instance-1"])
    })

    it("identifies a cloud browser by user id, with no alias, and tags its events", () => {
        const {client, calls} = recordingClient("old-device-id")
        adoptInstanceIdentity(
            client,
            {
                enabled: true,
                distinct_id: "user-1",
                groups: null,
                properties: {cloud_region: "US", cloud_url: "https://us.cloud.agenta.ai"},
            },
            {email: "person@example.test"},
        )
        expect(calls).toEqual([
            "reset",
            'identify user-1 {"email":"person@example.test"}',
            'register {"cloud_region":"US","cloud_url":"https://us.cloud.agenta.ai"}',
        ])
    })

    it("does not start over when the browser already holds the user id", () => {
        const {client, calls} = recordingClient("user-1")
        adoptInstanceIdentity(client, {
            enabled: true,
            distinct_id: "user-1",
            groups: null,
            properties: null,
        })
        expect(calls).toEqual(["identify user-1"])
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
