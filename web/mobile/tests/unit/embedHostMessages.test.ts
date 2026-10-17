import {describe, expect, it} from "vitest"

import {allowedParentOrigin, readHostMessage} from "../../src/features/embed/hostMessages"

const ALLOWED = ["https://tool.example.com"]
const parent = {}

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
