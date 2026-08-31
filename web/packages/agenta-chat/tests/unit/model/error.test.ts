import {describe, expect, it} from "vitest"

import {
    isTransportFailure,
    parseAgentRunError,
    TRANSPORT_ERROR_MESSAGE,
} from "../../../src/model/error"

describe("parseAgentRunError", () => {
    it("pulls message + code out of a status envelope carried on an Error", () => {
        const err = new Error(JSON.stringify({status: {code: 404, message: "Not found"}}))
        expect(parseAgentRunError(err)).toEqual({message: "Not found", code: 404})
    })

    it("pulls message + code out of a status envelope passed as a raw string", () => {
        const raw = JSON.stringify({status: {code: 500, message: "Boom"}})
        expect(parseAgentRunError(raw)).toEqual({message: "Boom", code: 500})
    })

    it("falls back to a top-level message when there's no status wrapper", () => {
        const raw = JSON.stringify({message: "Top level"})
        expect(parseAgentRunError(raw)).toEqual({message: "Top level", code: undefined})
    })

    it("passes a plain non-JSON string straight through", () => {
        expect(parseAgentRunError("Something broke")).toEqual({message: "Something broke"})
    })

    it("uses the real fallback copy for an undefined error", () => {
        expect(parseAgentRunError(undefined)).toEqual({message: "The agent run failed."})
    })

    it("uses the real fallback copy for an empty string", () => {
        expect(parseAgentRunError("")).toEqual({message: "The agent run failed."})
    })

    it("translates the browser's dropped-request text instead of showing it", () => {
        // What the user actually saw under "The agent run failed": the raw TypeError.
        expect(parseAgentRunError(new TypeError("Failed to fetch"))).toEqual({
            message: TRANSPORT_ERROR_MESSAGE,
            transport: true,
        })
    })

    it("recognises the other engines' wording for the same failure", () => {
        for (const raw of [
            "NetworkError when attempting to fetch resource.",
            "Load failed",
            "The network connection was lost.",
            "TypeError: Failed to fetch",
            "fetch failed",
        ]) {
            expect(parseAgentRunError(raw)).toMatchObject({transport: true})
        }
    })

    it("keeps a server verdict that happens to use those words, with its code", () => {
        // The envelope wins: a reason the server sent is a reason, and its code is worth more
        // than the translation.
        const raw = JSON.stringify({status: {code: 502, message: "Upstream fetch failed"}})
        expect(parseAgentRunError(raw)).toEqual({message: "Upstream fetch failed", code: 502})
    })

    it("does not mark ordinary run failures as transport", () => {
        expect(parseAgentRunError("Agent run failed: no usable credential")).toEqual({
            message: "Agent run failed: no usable credential",
        })
        expect(isTransportFailure("")).toBe(false)
        expect(isTransportFailure("The agent run failed.")).toBe(false)
    })
})
