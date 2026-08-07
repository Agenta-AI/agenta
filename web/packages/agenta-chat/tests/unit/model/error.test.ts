import {describe, expect, it} from "vitest"

import {parseAgentRunError} from "../../../src/model/error"

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
})
