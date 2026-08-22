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

    it("pulls message out of a FastAPI detail string", () => {
        const raw = JSON.stringify({detail: "Permission denied. Please check your permissions or contact your administrator."})
        expect(parseAgentRunError(raw)).toEqual({message: "Permission denied. Please check your permissions or contact your administrator."})
    })

    it("pulls message out of a FastAPI nested detail object", () => {
        const raw = JSON.stringify({
            detail: {
                message: "Agent failed to initialize due to a configuration error.",
                operation_id: "xyz-123"
            }
        })
        expect(parseAgentRunError(raw)).toEqual({message: "Agent failed to initialize due to a configuration error."})
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
