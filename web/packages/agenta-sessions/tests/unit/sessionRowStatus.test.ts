/**
 * A gate outlives the run that raised it, so "waiting" must win over liveness — otherwise a
 * session needing an answer reads as merely "running" and the user never acts on it.
 */
import type {SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {pendingGateLabel, sessionRowStatus} from "../../src/row/sessionRowStatus"

const row = (overrides: Partial<SessionStream> = {}): SessionStream =>
    ({
        project_id: "22222222-2222-4222-8222-222222222222",
        session_id: "sess-1",
        ...overrides,
    }) as SessionStream

const statusOf = (r: SessionStream, pending?: number) => sessionRowStatus(r, pending).status

describe("sessionRowStatus", () => {
    it("reports a pending gate ahead of a live run", () => {
        const running = row({flags: {is_alive: true, is_running: true}})
        expect(statusOf(running, 1)).toBe("waiting")
        expect(statusOf(running, 0)).toBe("running")
    })

    it("reports a gate even after the run that raised it finished", () => {
        expect(statusOf(row(), 2)).toBe("waiting")
    })

    it("separates a running turn from a merely warm sandbox", () => {
        expect(statusOf(row({flags: {is_alive: true, is_running: true}}))).toBe("running")
        expect(statusOf(row({flags: {is_alive: true}}))).toBe("alive")
    })

    it("prefers archived over ended, since archiving is the deliberate act", () => {
        const both = row({deleted_at: "2026-08-01T00:00:00Z", archived_at: "2026-08-02T00:00:00Z"})
        expect(statusOf(both)).toBe("archived")
        expect(statusOf(row({deleted_at: "2026-08-01T00:00:00Z"}))).toBe("ended")
    })

    it("falls back to idle for a session that has simply gone quiet", () => {
        expect(statusOf(row())).toBe("idle")
    })

    it("only pulses for states that need attention", () => {
        expect(sessionRowStatus(row(), 1).pulse).toBe(true)
        expect(sessionRowStatus(row({flags: {is_alive: true, is_running: true}})).pulse).toBe(true)
        expect(sessionRowStatus(row({flags: {is_alive: true}})).pulse).toBe(false)
        expect(sessionRowStatus(row()).pulse).toBe(false)
    })
})

describe("pendingGateLabel", () => {
    it("names what the session is asking for", () => {
        expect(pendingGateLabel(["user_approval"])).toBe("Approval")
        expect(pendingGateLabel(["user_input"])).toBe("Input")
        expect(pendingGateLabel(["client_tool"])).toBe("Tool call")
    })

    it("names a state rather than commanding one, because the chip does not act", () => {
        // The gate is answered in the session, where what is being decided is on screen.
        for (const kinds of [["user_approval"], ["user_input"], ["client_tool"], undefined]) {
            expect(pendingGateLabel(kinds)).not.toMatch(/^(Approve|Answer|Run|Reply|Open)$/)
        }
    })

    it("falls back to the generic label when the kind is unknown or absent", () => {
        expect(pendingGateLabel(undefined)).toBe("Waiting")
        expect(pendingGateLabel([])).toBe("Waiting")
        expect(pendingGateLabel(["something_new"])).toBe("Waiting")
    })

    it("does not claim one action when several are open", () => {
        expect(pendingGateLabel(["user_approval", "user_input"])).toBe("Multiple")
    })
})
