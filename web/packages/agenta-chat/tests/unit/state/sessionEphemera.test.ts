import {beforeEach, describe, expect, it} from "vitest"

import {
    attachmentsBySession,
    clearSessionEphemera,
    clearSessionFresh,
    clearSessionTurnId,
    composerDraftBySession,
    freshSessionIds,
    getSessionTurnId,
    isSessionFresh,
    markSessionFresh,
    setSessionTurnId,
    setAcceptedSessionTurnId,
} from "../../../src/state/sessionEphemera"

beforeEach(() => {
    clearSessionEphemera("s1")
    clearSessionEphemera("s2")
    composerDraftBySession.clear()
    attachmentsBySession.clear()
    freshSessionIds.clear()
})

describe("fresh-session marker", () => {
    it("marks, reads, and clears a session's fresh state", () => {
        expect(isSessionFresh("s1")).toBe(false)
        markSessionFresh("s1")
        expect(isSessionFresh("s1")).toBe(true)
        clearSessionFresh("s1")
        expect(isSessionFresh("s1")).toBe(false)
    })
})

describe("turn id freshness", () => {
    it("restores a resumed execution only after authoritative acceptance", () => {
        setSessionTurnId("s1", "older-turn")
        clearSessionTurnId("s1")
        setSessionTurnId("s1", "approval-turn")
        clearSessionTurnId("s1")
        setSessionTurnId("s1", "approval-turn")
        expect(getSessionTurnId("s1")).toBeUndefined()

        setAcceptedSessionTurnId("s1", "approval-turn")
        expect(getSessionTurnId("s1")).toBe("approval-turn")
        setSessionTurnId("s1", "older-turn")
        expect(getSessionTurnId("s1")).toBe("approval-turn")
    })

    it("does not resurrect the superseded turn while a resumed execution is starting", () => {
        setSessionTurnId("s1", "turn-parked")
        clearSessionTurnId("s1")
        clearSessionTurnId("s1")

        // An approval rerender must not restore old metadata before the new runner frame arrives.
        setSessionTurnId("s1", "turn-parked")
        expect(getSessionTurnId("s1")).toBeUndefined()

        setSessionTurnId("s1", "turn-resumed")
        expect(getSessionTurnId("s1")).toBe("turn-resumed")

        clearSessionTurnId("s1")
        setSessionTurnId("s1", "turn-latest")
        setSessionTurnId("s1", "turn-parked")
        expect(getSessionTurnId("s1")).toBe("turn-latest")
    })
})
