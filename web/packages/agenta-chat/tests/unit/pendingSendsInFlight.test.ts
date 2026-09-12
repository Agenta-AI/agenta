/**
 * The local "submitted" signal behind #6778. On the server-owned send path `useChat`'s status
 * never leaves "ready", so an echo that is neither refused nor parked is the only evidence that
 * a turn of ours is on its way — and the working indicator must read it.
 */
import {describe, expect, it} from "vitest"

import {pendingSendsInFlight, type PendingSendEcho} from "../../src/assets/pendingSendEchoes"

const echo = (patch: Partial<PendingSendEcho> = {}): PendingSendEcho => ({
    id: "e1",
    text: "hello",
    coveredAtUserCount: 1,
    createdAtUserCount: 0,
    ...patch,
})

describe("pendingSendsInFlight", () => {
    it("is false with nothing pending", () => {
        expect(pendingSendsInFlight([])).toBe(false)
    })

    it("is true from the moment a send is admitted, and still after the runner named it", () => {
        expect(pendingSendsInFlight([echo()])).toBe(true)
        expect(pendingSendsInFlight([echo({executionId: "x1"})])).toBe(true)
    })

    it("ignores refused sends and sends parked in the queue", () => {
        expect(pendingSendsInFlight([echo({failed: true})])).toBe(false)
        expect(pendingSendsInFlight([echo({parkedInputId: "in1"})])).toBe(false)
        expect(pendingSendsInFlight([echo({failed: true}), echo({id: "e2"})])).toBe(true)
    })
})
