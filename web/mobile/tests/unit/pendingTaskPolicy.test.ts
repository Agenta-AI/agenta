import {describe, expect, it} from "vitest"

import {canSendPendingTask, type PendingTaskGate} from "../../src/features/chat/pendingTaskPolicy"

const gate = (overrides: Partial<PendingTaskGate> = {}): PendingTaskGate => ({
    sessionId: "session-1",
    sentFor: null,
    hydrating: false,
    modelKeyLoading: false,
    modelBlocked: false,
    ...overrides,
})

describe("canSendPendingTask", () => {
    it("sends a parked task once the transcript has hydrated and a key exists", () => {
        expect(canSendPendingTask(gate())).toBe(true)
    })

    it("holds while the transcript is still hydrating", () => {
        expect(canSendPendingTask(gate({hydrating: true}))).toBe(false)
    })

    it("holds while the vault has not answered yet", () => {
        // The cold first run: hydration settles before the vault does, and `modelBlocked` is
        // still false because nothing has told us the project is keyless.
        expect(canSendPendingTask(gate({modelKeyLoading: true}))).toBe(false)
    })

    it("sends once an unresolved vault comes back with a key", () => {
        expect(canSendPendingTask(gate({modelKeyLoading: true}))).toBe(false)
        expect(canSendPendingTask(gate({modelKeyLoading: false, modelBlocked: false}))).toBe(true)
    })

    it("holds while the connect-model gate is up", () => {
        expect(canSendPendingTask(gate({modelBlocked: true}))).toBe(false)
    })

    it("releases the held task when the gate clears", () => {
        // The exact sequence a first-run user walks: type on Home, land keyless, add the key.
        expect(canSendPendingTask(gate({modelBlocked: true}))).toBe(false)
        expect(canSendPendingTask(gate({modelBlocked: false}))).toBe(true)
    })

    it("never sends twice for the same session", () => {
        expect(canSendPendingTask(gate({sentFor: "session-1"}))).toBe(false)
    })

    it("still sends for a session the guard did not fire for", () => {
        // The chat survives a session switch, so the guard holds a session id, not a flag.
        expect(canSendPendingTask(gate({sessionId: "session-2", sentFor: "session-1"}))).toBe(true)
    })
})
