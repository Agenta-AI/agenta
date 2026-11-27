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

    it("removes email addresses from typed answers on a self-hosted event", () => {
        const sent = stripInstanceUrl({
            properties: {
                $survey_response: "Contact person@example.com please",
                answers: ["Other", "ops@corp.example"],
                $set: {role_other: "admin, a.b@c.io"},
            },
            $set: {company_other: "x person@example.com"},
        })
        expect(JSON.stringify(sent)).not.toContain("@")
        expect(sent?.properties.$survey_response).toBe("Contact [email] please")
        expect(sent?.$set).toEqual({company_other: "x [email]"})
    })

    it("removes links from typed answers on a self-hosted event", () => {
        const sent = stripInstanceUrl({
            properties: {heard_from_other: "via https://example.com/invite?token=SECRET ok"},
            $set: {heard_from_other: "ftp://user:pass@host/x"},
        })
        expect(JSON.stringify(sent)).not.toContain("SECRET")
        expect(JSON.stringify(sent)).not.toContain("pass")
        expect(sent?.properties.heard_from_other).toBe("via [link] ok")
    })

    it("removes internal email addresses and links without a scheme", () => {
        const sent = stripInstanceUrl({
            properties: {
                company_other: "ask admin@intranet",
                heard_from_other: "see example.com/invite?token=SECRET or docs.agenta.ai",
            },
        })
        expect(JSON.stringify(sent)).not.toContain("SECRET")
        expect(sent?.properties.company_other).toBe("ask [email]")
        expect(sent?.properties.heard_from_other).toBe("see [link] or docs.agenta.ai")
    })

    it("removes links without a scheme that have a port or an IP address", () => {
        const sent = stripInstanceUrl({
            properties: {
                heard_from_other:
                    "a agenta.internal:8443/invite?token=S1 b 10.0.0.5/x?token=S2 c localhost:3000/x?t=S3",
            },
        })
        expect(JSON.stringify(sent)).not.toMatch(/S[123]/)
        expect(sent?.properties.heard_from_other).toBe("a [link] b [link] c [link]")
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
        expect(
            parseInstanceTelemetry({
                enabled: true,
                distinct_id: "i:u",
                groups: {instance: "i"},
                properties: {instance_kind: "test", ignored: 1},
            }).properties,
        ).toEqual({instance_kind: "test"})
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

    const recordingClient = (distinctId: string, userState: "anonymous" | "identified") => {
        const calls: string[] = []
        const client = {
            get_distinct_id: () => distinctId,
            get_property: (name: string) => (name === "$user_state" ? userState : undefined),
            reset: () => calls.push("reset"),
            identify: (id: string, properties?: Record<string, unknown>) =>
                calls.push(`identify ${id}${properties ? ` ${JSON.stringify(properties)}` : ""}`),
            group: (type: string, key: string) => calls.push(`group ${type} ${key}`),
            register: (properties: Record<string, string>) =>
                calls.push(`register ${JSON.stringify(properties)}`),
        }
        return {client, calls}
    }

    it("keeps the events of an anonymous browser: no reset, it identifies with the API id", () => {
        const {client, calls} = recordingClient("0190-random-anonymous-id", "anonymous")
        adoptInstanceIdentity(
            client,
            {enabled: true, distinct_id: "user-1", groups: null, properties: null},
            {email: "person@example.test"},
        )
        expect(calls).toEqual(['identify user-1 {"email":"person@example.test"}'])
    })

    it("starts over before it identifies a browser identified as an email", () => {
        const {client, calls} = recordingClient("person@example.test", "identified")
        adoptInstanceIdentity(client, {
            enabled: true,
            distinct_id: "instance-1:user-1",
            groups: {instance: "instance-1"},
            properties: {instance_kind: "test"},
        })
        expect(calls).toEqual([
            "reset",
            'register {"instance_kind":"test"}',
            "identify instance-1:user-1",
            "group instance instance-1",
        ])
    })

    it("starts over a browser identified as an old device id, then identifies it by user id", () => {
        const {client, calls} = recordingClient("old-device-id", "identified")
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
            'register {"cloud_region":"US","cloud_url":"https://us.cloud.agenta.ai"}',
            'identify user-1 {"email":"person@example.test"}',
        ])
    })

    it("does not start over when the browser already holds the user id", () => {
        const {client, calls} = recordingClient("user-1", "identified")
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
