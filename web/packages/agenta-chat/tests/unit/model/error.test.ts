import {describe, expect, it} from "vitest"

import {
    isSessionBusyRefusal,
    parseAgentRunError,
    SESSION_TURN_IN_USE_CODE,
    SESSION_TURN_IN_USE_MESSAGE,
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
})

describe("single-turn admission refusal", () => {
    // The runner refuses a message sent while another turn owns the session (#6417, #5539, #5538).
    // Nothing ran and nothing was sent, so the client keeps the user's text instead of losing it.
    // The message text is the contract with `services/runner/src/sessions/admission.ts`; it reaches
    // the browser verbatim through the SDK's `sanitize_runner_error` and the Vercel egress.

    it("recognises the refusal and carries its stable class", () => {
        expect(parseAgentRunError(new Error(SESSION_TURN_IN_USE_MESSAGE))).toEqual({
            message: SESSION_TURN_IN_USE_MESSAGE,
            code: SESSION_TURN_IN_USE_CODE,
        })
        expect(isSessionBusyRefusal(new Error(SESSION_TURN_IN_USE_MESSAGE))).toBe(true)
    })

    it("recognises it through surrounding whitespace, as the wire may add", () => {
        expect(isSessionBusyRefusal(`  ${SESSION_TURN_IN_USE_MESSAGE}\n`)).toBe(true)
    })

    it("does NOT claim an ordinary run failure, which must keep the failure bubble", () => {
        expect(isSessionBusyRefusal(new Error("The model provider timed out."))).toBe(false)
        expect(isSessionBusyRefusal(undefined)).toBe(false)
        expect(parseAgentRunError("The model provider timed out.").code).toBeUndefined()
    })

    it("keeps the message one line, or the SDK truncates it at the first newline", () => {
        expect(SESSION_TURN_IN_USE_MESSAGE).not.toContain("\n")
    })
})
