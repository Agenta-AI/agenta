/**
 * Reading the turn id off the stream, and keeping it per session.
 *
 * The runner mints a browser turn's id, so the client had no way to name the turn it was watching
 * and Stop could only say "cancel whatever is running" (#6417). The runner now emits
 * `{type: "turn", turnId}` first and the SDK forwards it as a `data-agent-turn` part.
 *
 * The reader must be strict: anything that is not that part, or carries no usable id, yields null,
 * because a wrong id would refuse a Stop that is correct.
 */
import {describe, expect, it} from "vitest"

import {turnIdFromDataPart} from "../../../src/assets/agentTurn"
import {
    clearSessionEphemera,
    getSessionTurnId,
    setSessionTurnId,
} from "../../../src/state/sessionEphemera"

describe("turnIdFromDataPart", () => {
    it("reads the id from the runner's turn part", () => {
        expect(turnIdFromDataPart({type: "data-agent-turn", data: {turnId: "turn-1"}})).toBe(
            "turn-1",
        )
    })

    it("ignores every other part the stream carries", () => {
        expect(turnIdFromDataPart({type: "data-agent-status", data: {phase: "booting"}})).toBeNull()
        expect(turnIdFromDataPart({type: "data-trace", data: {traceId: "t1"}})).toBeNull()
        expect(turnIdFromDataPart({type: "text", text: "hello"})).toBeNull()
    })

    it("yields null rather than a bad id", () => {
        expect(turnIdFromDataPart({type: "data-agent-turn", data: {}})).toBeNull()
        expect(turnIdFromDataPart({type: "data-agent-turn", data: {turnId: "   "}})).toBeNull()
        expect(turnIdFromDataPart({type: "data-agent-turn", data: {turnId: 7}})).toBeNull()
        expect(turnIdFromDataPart({type: "data-agent-turn"})).toBeNull()
        expect(turnIdFromDataPart(null)).toBeNull()
        expect(turnIdFromDataPart("data-agent-turn")).toBeNull()
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
