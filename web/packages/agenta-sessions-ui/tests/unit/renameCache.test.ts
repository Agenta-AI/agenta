import {describe, expect, it} from "vitest"

import {NAMED_SESSION_QUERY_KEYS, withRenamedSession} from "../../src/renameCache"

// A rename's write is not visible to the list read straight away, so the row is patched in the
// cache instead of refetched. The patch has to reach every shape a session list is cached in, and
// leave every other entry alone — a wrong guess here corrupts a cache rather than failing loudly.
describe("withRenamedSession", () => {
    const row = (id: string, name: string) => ({session_id: id, name})

    it("renames the matching row in the rail's flat array", () => {
        const data = [row("s1", "old"), row("s2", "other")]

        expect(withRenamedSession(data, "s1", "new")).toEqual([
            row("s1", "new"),
            row("s2", "other"),
        ])
    })

    it("renames inside a single query page", () => {
        const data = {count: 2, sessions: [row("s1", "old"), row("s2", "other")]}

        expect(withRenamedSession(data, "s1", "new")).toEqual({
            count: 2,
            sessions: [row("s1", "new"), row("s2", "other")],
        })
    })

    it("renames inside an infinite query's pages", () => {
        const data = {pageParams: [null], pages: [{sessions: [row("s1", "old")]}]}

        expect(withRenamedSession(data, "s1", "new")).toEqual({
            pageParams: [null],
            pages: [{sessions: [row("s1", "new")]}],
        })
    })

    // Identity matters: a fresh object would re-render every list that never held the session.
    it("hands back the same object when the session is absent", () => {
        const data = [row("s2", "other")]

        expect(withRenamedSession(data, "s1", "new")).toBe(data)
    })

    it("hands back the same object for a shape it does not recognise", () => {
        const data = {total: 3}

        expect(withRenamedSession(data, "s1", "new")).toBe(data)
    })

    it("leaves rows that are not objects alone", () => {
        const data = [null, undefined, row("s1", "old")]

        expect(withRenamedSession(data, "s1", "new")).toEqual([null, undefined, row("s1", "new")])
    })
})

describe("NAMED_SESSION_QUERY_KEYS", () => {
    // Not a rendered list, so it reads as unrelated — but the chat panel folds it into its tab
    // cache and prefers the REMOTE title, which is how an unpatched entry undoes a rename.
    it("covers the reconciliation cache the tab titles are folded from", () => {
        expect(NAMED_SESSION_QUERY_KEYS).toContain("internal-reconciliation")
    })

    // A rename cannot change a pending gate, and patching it would rewrite the wrong shape.
    it("leaves the interactions cache alone", () => {
        expect(NAMED_SESSION_QUERY_KEYS).not.toContain("sessions-page")
    })
})
