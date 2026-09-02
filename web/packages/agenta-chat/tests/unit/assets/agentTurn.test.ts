import type {UIMessage} from "ai"
import {afterEach, describe, expect, it} from "vitest"

import {
    getMessageTurnId,
    latestTurnId,
    turnIdFromDataPart,
} from "../../../src/assets/agentTurn"
import {
    clearSessionEphemera,
    clearSessionTurnId,
    getSessionTurnId,
    setSessionTurnId,
} from "../../../src/state/sessionEphemera"

const assistant = (id: string, metadata?: unknown): UIMessage =>
    ({id, role: "assistant", parts: [], metadata}) as UIMessage

const user = (id: string): UIMessage => ({id, role: "user", parts: []}) as UIMessage

afterEach(() => {
    clearSessionEphemera("s1")
    clearSessionEphemera("s2")
})

describe("getMessageTurnId", () => {
    it("reads the runner-minted id from message metadata", () => {
        expect(getMessageTurnId(assistant("a1", {turnId: "turn-1"}))).toBe("turn-1")
    })

    it("rejects missing and malformed ids", () => {
        expect(getMessageTurnId(assistant("a1"))).toBeNull()
        expect(getMessageTurnId(assistant("a2", {turnId: "   "}))).toBeNull()
        expect(getMessageTurnId(assistant("a3", {turnId: 7}))).toBeNull()
        expect(getMessageTurnId(undefined)).toBeNull()
    })
})

describe("latestTurnId", () => {
    it("reads only the newest assistant turn", () => {
        expect(
            latestTurnId([
                user("u1"),
                assistant("a1", {turnId: "turn-1"}),
                user("u2"),
                assistant("a2", {turnId: "turn-2"}),
            ]),
        ).toBe("turn-2")
    })

    it("does not fall back when the newest assistant has no id", () => {
        expect(latestTurnId([assistant("a1", {turnId: "turn-1"}), assistant("a2")])).toBeNull()
    })

    it("does not cross a trailing user message into an older turn", () => {
        expect(latestTurnId([assistant("a1", {turnId: "turn-A"}), user("u2")])).toBeNull()
    })
})

describe("session turn ids", () => {
    it("survives a pane remount and is replaced by the next admitted turn", () => {
        setSessionTurnId("s1", "turn-A")
        expect(getSessionTurnId("s1")).toBe("turn-A")

        setSessionTurnId("s1", "turn-B")
        expect(getSessionTurnId("s1")).toBe("turn-B")
    })

    it("is isolated per session and cleared with session ephemera", () => {
        setSessionTurnId("s1", "turn-1")
        setSessionTurnId("s2", "turn-2")

        clearSessionTurnId("s1")
        expect(getSessionTurnId("s1")).toBeUndefined()
        expect(getSessionTurnId("s2")).toBe("turn-2")

        clearSessionEphemera("s2")
        expect(getSessionTurnId("s2")).toBeUndefined()
    })
})

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
