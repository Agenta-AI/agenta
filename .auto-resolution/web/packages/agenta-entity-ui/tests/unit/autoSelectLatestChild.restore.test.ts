import {describe, expect, it} from "vitest"

import {resolveAutoSelectLatestChild} from "../../src/selection/hooks/modes/autoSelectLatestChild"

/**
 * Phase-2 gate (consequence half). The companion persister test in @agenta/shared proves that a
 * catalog-restored list query reports `isPending: false` but `isFetched: true` — EVEN when the
 * restored list is empty. These cases feed exactly those restore-shaped states into the real
 * auto-select resolver to show what the current logic decides, so we know whether persisting the
 * variant/revision LIST queries is a clean add or needs a selection-hook change first.
 */
const getId = (c: {id: string}) => c.id

describe("resolveAutoSelectLatestChild under persister restore", () => {
    it("non-empty restore (isPending:false, isFetched:true, children present) → selects first", () => {
        // A warm reload restores the revision list from disk; the newest is first.
        const decision = resolveAutoSelectLatestChild({
            children: [{id: "rev-2"}, {id: "rev-1"}],
            query: {isPending: false, isError: false, error: null, isFetched: true},
            getId,
        })
        expect(decision).toEqual({status: "select", child: {id: "rev-2"}})
    })

    it("HAZARD: empty restore (isFetched:true, no children) COMPLETES with no selection", () => {
        // Restore hydrated isFetched:true from disk, but the list is empty (persisted before any
        // revision, or a stale-empty entry). A background revalidate is about to bring the real
        // revision — but the resolver has already given up, because the `isFetched === false`
        // wait-guard only holds for a never-fetched query, not a restored one.
        const decision = resolveAutoSelectLatestChild({
            children: [],
            query: {isPending: false, isError: false, error: null, isFetched: true},
            getId,
        })
        // Documents the current (unsafe-for-persistence) behavior: it does NOT wait.
        expect(decision).toEqual({status: "complete"})
    })

    it("CONTRAST: cold empty (isFetched:false, no children) correctly waits", () => {
        // The pre-persistence path: a never-fetched empty list still waits for the query to settle.
        const decision = resolveAutoSelectLatestChild({
            children: [],
            query: {isPending: false, isError: false, error: null, isFetched: false},
            getId,
        })
        expect(decision).toEqual({status: "wait"})
    })
})
