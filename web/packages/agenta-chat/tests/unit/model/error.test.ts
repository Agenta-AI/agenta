import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {shouldAdoptServerTranscript} from "@agenta/entities/session"

import {
    isTransportFailure,
    isSessionBusyRefusal,
    parseAgentRunError,
    SESSION_TURN_IN_USE_CODE,
    SESSION_TURN_IN_USE_MESSAGE,
    TRANSPORT_ERROR_MESSAGE,
    withoutDeadSenderAcceptance,
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

    it("keeps a bare server verdict that merely contains those words", () => {
        // No envelope to fall back on, so the substring match was the only thing standing between
        // a 502 the server reached and "check your connection".
        expect(parseAgentRunError("Upstream fetch failed")).toEqual({
            message: "Upstream fetch failed",
        })
        expect(isTransportFailure("Agent run failed: fetch failed")).toBe(false)
        expect(isTransportFailure("Load failed for tool call")).toBe(false)
    })

    it("does not mark ordinary run failures as transport", () => {
        expect(parseAgentRunError("Agent run failed: no usable credential")).toEqual({
            message: "Agent run failed: no usable credential",
        })
        expect(isTransportFailure("")).toBe(false)
        expect(isTransportFailure("The agent run failed.")).toBe(false)
    })
})

describe("single-turn admission refusal", () => {
    // The runner refusal message is the browser recovery contract.

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

/**
 * A dead sender stream says nothing about a turn the server has already accepted. The invoke stream
 * carries acceptance and errors only, so once the runner has taken the turn it finishes and writes
 * it to the session log without us. That row must not be persisted, and must not be counted when
 * the adoption guard compares what we render with what the log holds — or a reload paints "Could
 * not reach Agenta" over a completed turn, and the count floor keeps it there.
 *
 * Everything else keeps its card, so each of the three conditions is tested on its own.
 */
describe("withoutDeadSenderAcceptance", () => {
    const user = {
        id: "u1",
        role: "user",
        parts: [{type: "text", text: "One more short line, please."}],
    } as unknown as UIMessage
    const transportStamp = {message: TRANSPORT_ERROR_MESSAGE, transport: true}
    // The shape a dropped sender stream really leaves: the AI SDK keeps the message the `start`
    // chunk opened, with the step marker and nothing else. The acceptance itself is transient, so
    // it never becomes a part.
    const acceptedCarrier = {
        id: "accepted",
        role: "assistant",
        parts: [{type: "step-start"}],
        metadata: {sharedSender: true, runError: transportStamp, turnAccepted: true},
    } as unknown as UIMessage

    it("drops the control row of a turn the server accepted", () => {
        expect(withoutDeadSenderAcceptance([user, acceptedCarrier]).map((m) => m.id)).toEqual([
            "u1",
        ])
    })

    it("keeps a failure with no acceptance — that turn may never have started", () => {
        // The stranded-send shape: the request died before the runner answered it.
        const neverAccepted = {
            id: "no-acceptance",
            role: "assistant",
            parts: [],
            metadata: {runError: transportStamp, turnAccepted: false},
        } as unknown as UIMessage
        expect(withoutDeadSenderAcceptance([user, neverAccepted]).map((m) => m.id)).toEqual([
            "u1",
            "no-acceptance",
        ])
    })

    it("keeps a turn that carries content, stamp and all", () => {
        // The legacy path, where the invoke stream IS the answer: a partial turn is a turn.
        const partial = {
            id: "a1",
            role: "assistant",
            parts: [{type: "step-start"}, {type: "text", text: "half an ans"}],
            metadata: {runError: transportStamp, turnAccepted: true},
        } as unknown as UIMessage
        const [, kept] = withoutDeadSenderAcceptance([user, partial])
        expect(kept.id).toBe("a1")
        expect((kept.metadata as {runError?: unknown}).runError).toEqual(transportStamp)
    })

    it("keeps a verdict the server issued, accepted turn or not", () => {
        const refused = {
            ...acceptedCarrier,
            id: "refused",
            metadata: {
                sharedSender: true,
                turnAccepted: true,
                runError: {message: "no usable credential", code: 422},
            },
        } as unknown as UIMessage
        expect(withoutDeadSenderAcceptance([user, refused]).map((m) => m.id)).toEqual([
            "u1",
            "refused",
        ])
    })

    it("returns the same array when there is nothing to drop", () => {
        const messages = [user]
        expect(withoutDeadSenderAcceptance(messages)).toBe(messages)
    })

    it("lets the adoption guard take a running server turn over a failed local one", () => {
        // The reload case: local = the user turn + the dead stream's row, while the log has recorded
        // the user turn and is still writing the answer. Counting that row makes the local copy look
        // longer, and the floor rule then refuses the transcript that follows.
        const local = [user, acceptedCarrier]
        const guard = (localMessageCount: number) =>
            shouldAdoptServerTranscript({
                serverRecordCount: 3,
                serverMessageCount: 1,
                localMessageCount,
                watermark: undefined,
                busy: false,
            })
        expect(guard(local.length)).toBe(false)
        expect(guard(withoutDeadSenderAcceptance(local).length)).toBe(true)
    })
})
