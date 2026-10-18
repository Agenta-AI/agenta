import {describe, expect, it} from "vitest"

import {
    allowedParentOrigin,
    originAllowed,
    readHostMessage,
} from "../../src/features/embed/hostMessages"

const ALLOWED = ["https://tool.example.com"]
const parent = {}

describe("originAllowed", () => {
    const WILDCARD = ["https://*.example.com", "http://*.local.test:3000"]

    it("matches any subdomain of a wildcard entry, not the bare domain", () => {
        expect(originAllowed("https://a.example.com", WILDCARD)).toBe(true)
        expect(originAllowed("https://a.b.example.com", WILDCARD)).toBe(true)
        expect(originAllowed("http://app.local.test:3000", WILDCARD)).toBe(true)
        expect(originAllowed("https://example.com", WILDCARD)).toBe(false)
        expect(originAllowed("https://.example.com", WILDCARD)).toBe(false)
    })

    it("keeps the scheme and the port of a wildcard entry", () => {
        expect(originAllowed("http://a.example.com", WILDCARD)).toBe(false)
        expect(originAllowed("https://a.example.com:8443", WILDCARD)).toBe(false)
        expect(originAllowed("http://app.local.test", WILDCARD)).toBe(false)
        expect(originAllowed("https://evilexample.com", WILDCARD)).toBe(false)
        expect(originAllowed("https://a.example.com.evil.test", WILDCARD)).toBe(false)
    })

    it("matches every origin for *", () => {
        expect(originAllowed("https://anything.test", ["*"])).toBe(true)
        expect(originAllowed("http://localhost:8791", ["*"])).toBe(true)
    })
})

describe("allowedParentOrigin", () => {
    it("takes the ancestor origin first, then the referrer", () => {
        expect(allowedParentOrigin({ancestorOrigin: "https://tool.example.com"}, ALLOWED)).toBe(
            "https://tool.example.com",
        )
        expect(
            allowedParentOrigin({referrer: "https://tool.example.com/orders/42?x=1"}, ALLOWED),
        ).toBe("https://tool.example.com")
    })

    it("is null for a parent that is not an allowed origin, or unknown", () => {
        expect(allowedParentOrigin({ancestorOrigin: "https://evil.example.com"}, ALLOWED)).toBe(
            null,
        )
        expect(allowedParentOrigin({referrer: ""}, ALLOWED)).toBe(null)
        expect(allowedParentOrigin({referrer: "not a url"}, ALLOWED)).toBe(null)
    })

    it("is the parent's own origin when any site may embed", () => {
        expect(allowedParentOrigin({referrer: "https://any.test/page"}, ["*"])).toBe(
            "https://any.test",
        )
        expect(allowedParentOrigin({referrer: ""}, ["*"])).toBe(null)
    })
})

describe("readHostMessage", () => {
    const from = (data: unknown, origin = "https://tool.example.com", source: unknown = parent) =>
        readHostMessage({data, origin, source} as MessageEvent, {parent, allowedOrigins: ALLOWED})

    it("reads agenta:init and agenta:context from the parent on an allowed origin", () => {
        expect(
            from({
                type: "agenta:init",
                visitorKey: "k",
                displayName: "Ada",
                context: {page: "/orders/42"},
            }),
        ).toEqual({
            type: "init",
            visitorKey: "k",
            displayName: "Ada",
            context: {page: "/orders/42"},
        })
        expect(from({type: "agenta:context", context: {page: "/a"}})).toEqual({
            type: "context",
            context: {page: "/a"},
        })
    })

    it("ignores a message from another origin or another window", () => {
        expect(from({type: "agenta:init"}, "https://evil.example.com")).toBe(null)
        expect(from({type: "agenta:init"}, "https://tool.example.com", {})).toBe(null)
    })

    it("hears the parent on any origin when any site may embed, but never another window", () => {
        const read = (origin: string, source: unknown) =>
            readHostMessage(
                {data: {type: "agenta:context", context: {}}, origin, source} as MessageEvent,
                {
                    parent,
                    allowedOrigins: ["*"],
                },
            )
        expect(read("https://any.test", parent)).toEqual({type: "context", context: {}})
        expect(read("https://any.test", {})).toBe(null)
    })

    it("hears the parent on a wildcard origin", () => {
        const event = {
            data: {type: "agenta:context", context: {}},
            origin: "https://a.example.com",
            source: parent,
        }
        expect(
            readHostMessage(event as MessageEvent, {
                parent,
                allowedOrigins: ["https://*.example.com"],
            }),
        ).toEqual({type: "context", context: {}})
    })

    it("ignores unknown types and drops fields of the wrong shape", () => {
        expect(from({type: "agenta:other"})).toBe(null)
        expect(from("agenta:init")).toBe(null)
        expect(from({type: "agenta:context", context: ["not", "an", "object"]})).toBe(null)
        expect(from({type: "agenta:init", displayName: 3, context: "x"})).toEqual({
            type: "init",
            visitorKey: undefined,
            displayName: undefined,
            context: undefined,
        })
    })
})
