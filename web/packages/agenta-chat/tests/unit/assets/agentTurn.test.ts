import type {UIMessage} from "ai"
import {afterEach, describe, expect, it} from "vitest"

import {getMessageTurnId, latestTurnId} from "../../../src/assets/agentTurn"
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
