import type {SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {livenessBySession} from "../../src/features/sessions/useLivenessPoll"

const stream = (session_id: string, flags?: SessionStream["flags"]) =>
    ({session_id, flags}) as SessionStream

describe("livenessBySession", () => {
    it("badges a running session from the poll's flags", () => {
        const map = livenessBySession([
            stream("s-running", {is_alive: true, is_running: true, is_attached: false}),
        ])
        expect(map?.get("s-running")).toBe("running")
    })

    it("badges an alive-but-idle session (parked awaiting approval) as live, not running", () => {
        // A parked turn has ended, so `running` collapses while `alive` outlives it — that
        // pairing is exactly what the backend heartbeat mirror writes at turn end.
        const map = livenessBySession([
            stream("s-parked", {is_alive: true, is_running: false, is_attached: false}),
        ])
        expect(map?.get("s-parked")).toBe("alive")
    })

    it("omits sessions the poll did not return, so a reclaimed row loses its badge", () => {
        const map = livenessBySession([stream("s-alive", {is_alive: true, is_running: true})])
        expect(map?.has("s-swept")).toBe(false)
        expect(map?.get("s-swept")).toBeUndefined()
    })

    it("stays undefined until the poll resolves, so rows render unbadged rather than wrong", () => {
        expect(livenessBySession(undefined)).toBeUndefined()
        expect(livenessBySession(null)).toBeUndefined()
    })

    // Parity with the desktop dot: the shared derivation defaults every flag to false, so a row
    // with no live process reads as idle instead of being badged live off the poll's filter alone.
    it("omits a flagless row rather than assuming it is alive", () => {
        const map = livenessBySession([stream("s-no-flags")])
        expect(map?.has("s-no-flags")).toBe(false)
    })

    it("omits a zombie row whose flags no longer say alive", () => {
        const map = livenessBySession([
            stream("s-zombie", {is_alive: false, is_running: false, is_attached: false}),
        ])
        expect(map?.has("s-zombie")).toBe(false)
    })

    // `is_running` outranks a stale `is_alive` — the same precedence as `sessionDotStatusAtomFamily`.
    it("badges a running row even if its alive flag lags behind", () => {
        const map = livenessBySession([
            stream("s-racing", {is_alive: false, is_running: true, is_attached: true}),
        ])
        expect(map?.get("s-racing")).toBe("running")
    })

    it("badges an attached-but-idle sandbox as live", () => {
        const map = livenessBySession([
            stream("s-attached", {is_alive: true, is_running: false, is_attached: true}),
        ])
        expect(map?.get("s-attached")).toBe("alive")
    })
})
