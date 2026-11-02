// @vitest-environment jsdom
/**
 * A chat this tab created is still known as its own after a reload. The in-memory fresh marker
 * is not: it decides hydration, and a reload must not change that.
 */
import {beforeEach, describe, expect, it} from "vitest"

import {
    clearSessionFresh,
    forgetSessionCreatedHere,
    freshSessionIds,
    isSessionCreatedHere,
    isSessionFresh,
    markSessionFresh,
} from "../../src/session/core/freshSessions"

// A reload keeps `sessionStorage` and loses module memory.
const reload = () => freshSessionIds.clear()

beforeEach(() => {
    sessionStorage.clear()
    freshSessionIds.clear()
})

describe("sessions created in this tab", () => {
    it("are still known as created here after a reload, but no longer fresh", () => {
        markSessionFresh("s1")
        reload()

        expect(isSessionCreatedHere("s1")).toBe(true)
        expect(isSessionFresh("s1")).toBe(false)
    })

    it("stay created here after the first send clears the fresh marker", () => {
        markSessionFresh("s1")
        clearSessionFresh("s1")

        expect(isSessionCreatedHere("s1")).toBe(true)
    })

    it("are forgotten when the session is deleted", () => {
        markSessionFresh("s1")
        forgetSessionCreatedHere("s1")
        reload()

        expect(isSessionCreatedHere("s1")).toBe(false)
    })

    it("are not known for a session this tab never created", () => {
        expect(isSessionCreatedHere("other")).toBe(false)
    })

    it("keep only the newest 50", () => {
        for (let i = 0; i < 51; i++) markSessionFresh(`s${i}`)
        reload()

        expect(isSessionCreatedHere("s0")).toBe(false)
        expect(isSessionCreatedHere("s50")).toBe(true)
    })

    it("ignore a stored value that is not a list", () => {
        sessionStorage.setItem("agenta:sessions-created-here", "{")
        expect(isSessionCreatedHere("s1")).toBe(false)
        markSessionFresh("s1")
        reload()
        expect(isSessionCreatedHere("s1")).toBe(true)
    })
})
