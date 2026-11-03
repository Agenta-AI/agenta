import {describe, expect, it} from "vitest"

import {
    MODEL_KEY_WAIT_LIMIT_MS,
    pendingTaskDecision,
    type PendingTaskGate,
} from "../../src/features/chat/pendingTaskPolicy"

const gate = (overrides: Partial<PendingTaskGate> = {}): PendingTaskGate => ({
    sessionId: "session-1",
    sentFor: null,
    hydrating: false,
    modelKeyLoading: false,
    modelKeyWaitedMs: 0,
    modelBlocked: false,
    ...overrides,
})

describe("pendingTaskDecision", () => {
    it("sends a parked task once the transcript has hydrated and a key exists", () => {
        expect(pendingTaskDecision(gate())).toBe("send")
    })

    it("holds while the transcript is still hydrating", () => {
        expect(pendingTaskDecision(gate({hydrating: true}))).toBe("hold")
    })

    it("holds while the vault has not answered yet", () => {
        // The cold first run: hydration settles before the vault does, and `modelBlocked` is
        // still false because nothing has told us the project is keyless.
        expect(pendingTaskDecision(gate({modelKeyLoading: true}))).toBe("hold")
    })

    it("sends once an unresolved vault comes back with a key", () => {
        expect(pendingTaskDecision(gate({modelKeyLoading: true}))).toBe("hold")
        expect(pendingTaskDecision(gate({modelKeyLoading: false, modelBlocked: false}))).toBe(
            "send",
        )
    })

    it("holds while the connect-model gate is up", () => {
        expect(pendingTaskDecision(gate({modelBlocked: true}))).toBe("hold")
    })

    it("releases the held task when the gate clears", () => {
        // The exact sequence a first-run user walks: type on Home, land keyless, add the key.
        expect(pendingTaskDecision(gate({modelBlocked: true}))).toBe("hold")
        expect(pendingTaskDecision(gate({modelBlocked: false}))).toBe("send")
    })

    it("never sends twice for the same session", () => {
        expect(pendingTaskDecision(gate({sentFor: "session-1"}))).toBe("hold")
    })

    it("still sends for a session the guard did not fire for", () => {
        // The chat survives a session switch, so the guard holds a session id, not a flag.
        expect(pendingTaskDecision(gate({sessionId: "session-2", sentFor: "session-1"}))).toBe(
            "send",
        )
    })

    describe("the bound on the vault wait", () => {
        it("holds right up to the limit", () => {
            expect(
                pendingTaskDecision(
                    gate({modelKeyLoading: true, modelKeyWaitedMs: MODEL_KEY_WAIT_LIMIT_MS - 1}),
                ),
            ).toBe("hold")
        })

        it("abandons at the limit, when the vault is still unresolved", () => {
            // A vault outage must not park a first message forever: the query has no retry cap,
            // and this hold is invisible (no strip, a usable composer).
            expect(
                pendingTaskDecision(
                    gate({modelKeyLoading: true, modelKeyWaitedMs: MODEL_KEY_WAIT_LIMIT_MS}),
                ),
            ).toBe("abandon")
        })

        it("abandons past the limit too", () => {
            expect(
                pendingTaskDecision(
                    gate({modelKeyLoading: true, modelKeyWaitedMs: MODEL_KEY_WAIT_LIMIT_MS * 3}),
                ),
            ).toBe("abandon")
        })

        it("sends rather than abandons when the vault answers on the deadline", () => {
            // Elapsed time alone never releases a task — the vault must still be unresolved.
            expect(
                pendingTaskDecision(
                    gate({modelKeyLoading: false, modelKeyWaitedMs: MODEL_KEY_WAIT_LIMIT_MS * 3}),
                ),
            ).toBe("send")
        })

        it("does NOT bound the wait on an active gate", () => {
            // That hold is the feature: the strip explains it, the composer is disabled, and the
            // user releases it by saving a key. Only the invisible wait is bounded.
            expect(
                pendingTaskDecision(
                    gate({modelBlocked: true, modelKeyWaitedMs: MODEL_KEY_WAIT_LIMIT_MS * 100}),
                ),
            ).toBe("hold")
        })

        it("does not abandon a task that was already sent", () => {
            expect(
                pendingTaskDecision(
                    gate({
                        sentFor: "session-1",
                        modelKeyLoading: true,
                        modelKeyWaitedMs: MODEL_KEY_WAIT_LIMIT_MS,
                    }),
                ),
            ).toBe("hold")
        })

        it("waits out hydration before the vault bound can fire", () => {
            // Hydration is checked first: a slow transcript must not be read as a vault outage.
            expect(
                pendingTaskDecision(
                    gate({
                        hydrating: true,
                        modelKeyLoading: true,
                        modelKeyWaitedMs: MODEL_KEY_WAIT_LIMIT_MS,
                    }),
                ),
            ).toBe("hold")
        })
    })
})
