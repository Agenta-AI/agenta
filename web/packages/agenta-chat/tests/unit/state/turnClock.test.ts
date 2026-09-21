import {createStore} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    clearTurnClockAtom,
    settleTurnSpanAtom,
    startTurnClockAtom,
    startTurnSpanAtom,
    turnSpanAtomFamily,
    turnStartAtomFamily,
} from "../../../src/state/turnClock"

describe("turn startup label", () => {
    it("has no label for an idle session", () => {
        const store = createStore()
        expect(store.get(turnStartAtomFamily("idle"))).toBeUndefined()
    })

    it("records and replaces the latest observed label", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "session", "Working")
        expect(store.get(turnStartAtomFamily("session"))).toBe("Working")

        store.set(startTurnClockAtom, "session", "Ready")
        expect(store.get(turnStartAtomFamily("session"))).toBe("Ready")
    })

    it("clears idempotently on every terminal path", () => {
        const store = createStore()
        store.set(startTurnClockAtom, "session", "Working")
        store.set(clearTurnClockAtom, "session")
        store.set(clearTurnClockAtom, "session")
        expect(store.get(turnStartAtomFamily("session"))).toBeUndefined()
    })
})

describe("turn span", () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    const at = (iso: string) => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date(iso))
    }

    it("counts from now for a run this tab started", () => {
        at("2026-09-21T10:00:00Z")
        const store = createStore()
        store.set(startTurnSpanAtom, "turn")
        expect(store.get(turnSpanAtomFamily("turn"))?.startedAt).toBe(Date.now())
    })

    // #6934: a tab opened on a response already in progress had no span, so the clock counted the
    // age of the tab. The run's own start is what the reader is asking about.
    it("counts from the run's start for a turn met mid-flight", () => {
        at("2026-09-21T10:00:40Z")
        const began = Date.parse("2026-09-21T10:00:00Z")
        const store = createStore()
        store.set(startTurnSpanAtom, "turn", began)
        expect(store.get(turnSpanAtomFamily("turn"))?.startedAt).toBe(began)
    })

    // The clock has to start before the trace it reads resolves, so the start arrives a beat late.
    it("back-dates a running span when the start arrives late", () => {
        at("2026-09-21T10:00:40Z")
        const began = Date.parse("2026-09-21T10:00:00Z")
        const store = createStore()
        store.set(startTurnSpanAtom, "turn")
        expect(store.get(turnSpanAtomFamily("turn"))?.startedAt).toBe(Date.now())

        store.set(startTurnSpanAtom, "turn", began)
        expect(store.get(turnSpanAtomFamily("turn"))?.startedAt).toBe(began)
    })

    it("back-dates once, so a second late start cannot move it again", () => {
        at("2026-09-21T10:00:40Z")
        const began = Date.parse("2026-09-21T10:00:00Z")
        const store = createStore()
        store.set(startTurnSpanAtom, "turn")
        store.set(startTurnSpanAtom, "turn", began)
        store.set(startTurnSpanAtom, "turn", Date.parse("2026-09-21T09:59:00Z"))
        expect(store.get(turnSpanAtomFamily("turn"))?.startedAt).toBe(began)
    })

    // Moving the start forward would rewind a clock the reader is already watching.
    it("ignores a start later than the one it is already counting from", () => {
        at("2026-09-21T10:00:40Z")
        const store = createStore()
        store.set(startTurnSpanAtom, "turn")
        const started = store.get(turnSpanAtomFamily("turn"))?.startedAt
        store.set(startTurnSpanAtom, "turn", Date.now())
        expect(store.get(turnSpanAtomFamily("turn"))?.startedAt).toBe(started)
    })

    it.each([
        ["in the future", () => Date.now() + 60_000],
        ["older than any run", () => Date.now() - 48 * 60 * 60 * 1000],
        ["not a number", () => Number.NaN],
    ])("falls back to now for a start %s", (_label, hint) => {
        at("2026-09-21T10:00:40Z")
        const store = createStore()
        store.set(startTurnSpanAtom, "turn", hint())
        expect(store.get(turnSpanAtomFamily("turn"))?.startedAt).toBe(Date.now())
    })

    // The freeze exists to keep parked time out of the count, so a resume must still shift.
    it("shifts an anchored span by the pause rather than re-anchoring it", () => {
        at("2026-09-21T10:00:40Z")
        const began = Date.parse("2026-09-21T10:00:00Z")
        const store = createStore()
        store.set(startTurnSpanAtom, "turn", began)
        store.set(settleTurnSpanAtom, "turn")

        // 30s parked on the reader.
        at("2026-09-21T10:01:10Z")
        store.set(startTurnSpanAtom, "turn", began)
        const span = store.get(turnSpanAtomFamily("turn"))
        expect(span?.startedAt).toBe(began + 30_000)
        expect(span?.endedAt).toBeUndefined()
        expect(Date.now() - (span?.startedAt ?? 0)).toBe(40_000)
    })
})
