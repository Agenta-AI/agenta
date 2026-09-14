import {describe, expect, it} from "vitest"

import {extractConnectionErrorMessage, extractSlackRequestUrl} from "./SlackOwnAppSection"

describe("extractSlackRequestUrl", () => {
    it("reads request_url out of the generated manifest JSON", () => {
        const doc = {
            format: "json",
            content: JSON.stringify({
                settings: {
                    event_subscriptions: {
                        request_url: "https://example.com/channels/slack/events/",
                    },
                },
            }),
        }

        expect(extractSlackRequestUrl(doc)).toBe("https://example.com/channels/slack/events/")
    })

    it("returns null when there is no document", () => {
        expect(extractSlackRequestUrl(null)).toBeNull()
        expect(extractSlackRequestUrl(undefined)).toBeNull()
    })

    it("returns null for unparsable content instead of throwing", () => {
        expect(extractSlackRequestUrl({format: "json", content: "not json"})).toBeNull()
    })
})

describe("extractConnectionErrorMessage", () => {
    it("prefers the service's own detail message from an AgentaApiError-shaped body", () => {
        const err = {body: {detail: "invalid_auth"}}

        expect(extractConnectionErrorMessage(err)).toBe("invalid_auth")
    })

    it("falls back to the error's own message", () => {
        expect(extractConnectionErrorMessage(new Error("network down"))).toBe("network down")
    })

    it("falls back to a generic message for anything else", () => {
        expect(extractConnectionErrorMessage("weird")).toBe("Failed to verify the connection")
    })
})
