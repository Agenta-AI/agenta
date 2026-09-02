/**
 * Reading the turn id off the stream, and keeping it per session.
 *
 * The runner mints a browser turn's id, so the client had no way to name the turn it was watching
 * and Stop could only say "cancel whatever is running" (#6417). The runner now sends it as a
 * `message-metadata` chunk, so it lands on `message.metadata.turnId` beside the `sessionId` the
 * start frame sets, and the SDK merges metadata so the finish frame does not overwrite it.
 *
 * The readers must be strict, and must consult only the NEWEST assistant message: an older one
 * carries an older turn's id, and naming a turn that has ended would refuse a correct Stop.
 */
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getMessageTurnId, latestTurnId} from "../../../src/assets/agentTurn"
import {
    clearSessionEphemera,
    getSessionTurnId,
    setSessionTurnId,
} from "../../../src/state/sessionEphemera"

const assistant = (metadata?: unknown): UIMessage =>
    ({id: `m${Math.random()}`, role: "assistant", parts: [], metadata}) as unknown as UIMessage

const user = (): UIMessage =>
    ({id: `u${Math.random()}`, role: "user", parts: []}) as unknown as UIMessage

describe("getMessageTurnId", () => {
    it("reads the id the runner put in the message metadata", () => {
        expect(getMessageTurnId(assistant({turnId: "turn-1", sessionId: "s1"}))).toBe("turn-1")
    })

    it("yields null rather than a bad id", () => {
        expect(getMessageTurnId(assistant({sessionId: "s1", traceId: "t1"}))).toBeNull()
        expect(getMessageTurnId(assistant({turnId: "   "}))).toBeNull()
        expect(getMessageTurnId(assistant({turnId: 7}))).toBeNull()
        expect(getMessageTurnId(assistant())).toBeNull()
        expect(getMessageTurnId(undefined)).toBeNull()
    })
})

describe("latestTurnId", () => {
    it("takes the newest assistant turn's id, not an older one", () => {
        expect(
            latestTurnId([
                user(),
                assistant({turnId: "turn-1"}),
                user(),
                assistant({turnId: "turn-2"}),
            ]),
        ).toBe("turn-2")
    })

    it("does not fall back to an older turn when the newest carries no id", () => {
        expect(latestTurnId([assistant({turnId: "turn-1"}), assistant({})])).toBeNull()
    })

    it("looks past a trailing user message", () => {
        expect(latestTurnId([assistant({turnId: "turn-1"}), user()])).toBe("turn-1")
    })

    it("is null for an empty transcript and for one with no assistant turn", () => {
        expect(latestTurnId([])).toBeNull()
        expect(latestTurnId([user()])).toBeNull()
    })
})

describe("the per-session turn id", () => {
    it("is undefined until a stream names one", () => {
        expect(getSessionTurnId("never-seen")).toBeUndefined()
    })

    it("keeps one id per session and lets a new turn replace it", () => {
        setSessionTurnId("s1", "turn-1")
        setSessionTurnId("s2", "turn-9")
        expect(getSessionTurnId("s1")).toBe("turn-1")

        setSessionTurnId("s1", "turn-2")
        expect(getSessionTurnId("s1")).toBe("turn-2")
        expect(getSessionTurnId("s2")).toBe("turn-9")
    })

    it("is dropped with the rest of a deleted session's ephemera", () => {
        setSessionTurnId("s3", "turn-3")
        clearSessionEphemera("s3")
        expect(getSessionTurnId("s3")).toBeUndefined()
    })
})
