import type {SessionStream} from "@agenta/entities/session"
import {describe, expect, it} from "vitest"

import {
    awaitingHiddenRows,
    isStartedSession,
    selectedSessionListPolicy,
    sessionListIdGroupLimit,
    sessionListRequestFilters,
    shouldLoadMoreForHiddenRows,
    startedSessions,
} from "../../src/state/sessionListPolicy"

const streamRow = (row: Partial<SessionStream>): SessionStream =>
    ({project_id: "project-1", session_id: "session-1", ...row}) as SessionStream

describe("sessionListRequestFilters", () => {
    it("maps each explicit origin policy into canonical entity filters", () => {
        expect(sessionListRequestFilters({origin: "all", expansions: []})).toEqual({
            origins: undefined,
            excludeOrigins: undefined,
            expand: [],
        })
        expect(
            sessionListRequestFilters({origin: "exclude-trigger", expansions: ["last_message"]}),
        ).toEqual({
            origins: undefined,
            excludeOrigins: ["trigger"],
            expand: ["last_message"],
        })
        expect(
            sessionListRequestFilters({
                origin: "trigger-only",
                expansions: ["last_message", "trigger"],
            }),
        ).toEqual({
            origins: ["trigger"],
            excludeOrigins: undefined,
            expand: ["last_message", "trigger"],
        })
        // Agent overview's automation section: needs the trigger name to resolve, but never
        // requests message previews (unlike Home/Sessions automation mode above).
        expect(
            sessionListRequestFilters({
                origin: "trigger-only",
                expansions: ["trigger"],
            }),
        ).toEqual({
            origins: ["trigger"],
            excludeOrigins: undefined,
            expand: ["trigger"],
        })
    })

    it("selects one policy for both pinned and recent Sessions groups", () => {
        const defaultPolicy = {origin: "exclude-trigger", expansions: ["last_message"]} as const
        const automationPolicy = {
            origin: "trigger-only",
            expansions: ["last_message", "trigger"],
        } as const

        expect(selectedSessionListPolicy(false, defaultPolicy, automationPolicy)).toBe(
            defaultPolicy,
        )
        expect(selectedSessionListPolicy(true, defaultPolicy, automationPolicy)).toBe(
            automationPolicy,
        )
    })

    it("requests all 100 normalized pinned session ids", () => {
        const ids = Array.from({length: 100}, (_, index) => `pin-${index}`)
        expect(sessionListIdGroupLimit([...ids, ...ids], undefined)).toBe(100)
    })

    it("requests all 100 waiting session ids instead of the default page", () => {
        const ids = Array.from({length: 100}, (_, index) => `waiting-${index}`)
        expect(sessionListIdGroupLimit(ids, 30)).toBe(100)
    })
})

describe("isStartedSession", () => {
    // The runtime beats a stream row into existence as soon as a chat is opened, so the row a
    // list must hide carries nothing but liveness flags.
    it("hides a chat that was opened but never used", () => {
        expect(isStartedSession(streamRow({flags: {is_alive: true, is_running: false}}))).toBe(
            false,
        )
        expect(isStartedSession(streamRow({name: "   ", references: []}))).toBe(false)
    })

    it("shows a session the moment it has a turn, a title, or a message", () => {
        expect(isStartedSession(streamRow({references: [{id: "019ff0c7-9842-7671"}]}))).toBe(true)
        expect(isStartedSession(streamRow({name: "Refund policy"}))).toBe(true)
        expect(isStartedSession(streamRow({last_message: {content: "hello"}}))).toBe(true)
    })

    // An automation row IS its schedule — it has an identity before its first turn, and the
    // automations list must never blank.
    it("keeps automation rows regardless of turns", () => {
        expect(isStartedSession(streamRow({origin: "trigger"}))).toBe(true)
        expect(isStartedSession(streamRow({trigger: {id: "trigger-1", kind: "schedule"}}))).toBe(
            true,
        )
    })

    it("filters a page down to the started rows, keeping order", () => {
        const rows = [
            streamRow({session_id: "a", name: "Named"}),
            streamRow({session_id: "b"}),
            streamRow({session_id: "c", references: [{id: "app-1"}]}),
        ]
        expect(startedSessions(rows).map((row) => row.session_id)).toEqual(["a", "c"])
    })
})

describe("shouldLoadMoreForHiddenRows", () => {
    // Unstarted rows are the NEWEST, so a burst of opened chats can fill a whole 30-row page.
    it("pulls the next page when the loaded one is entirely hidden", () => {
        expect(
            shouldLoadMoreForHiddenRows({
                visibleRows: 0,
                hasNextPage: true,
                isFetchingNextPage: false,
            }),
        ).toBe(true)
    })

    it("does not stack fetches, and stops at the last page", () => {
        expect(
            shouldLoadMoreForHiddenRows({
                visibleRows: 0,
                hasNextPage: true,
                isFetchingNextPage: true,
            }),
        ).toBe(false)
        expect(
            shouldLoadMoreForHiddenRows({
                visibleRows: 0,
                hasNextPage: false,
                isFetchingNextPage: false,
            }),
        ).toBe(false)
    })

    it("leaves a page that has something to show alone", () => {
        expect(
            shouldLoadMoreForHiddenRows({
                visibleRows: 1,
                hasNextPage: true,
                isFetchingNextPage: false,
            }),
        ).toBe(false)
    })

    // A failed `fetchNextPage` leaves `hasNextPage` true, so retrying on it spins forever.
    it("does not retry a page that just failed", () => {
        expect(
            shouldLoadMoreForHiddenRows({
                visibleRows: 0,
                hasNextPage: true,
                isFetchingNextPage: false,
                isError: true,
            }),
        ).toBe(false)
    })
})

describe("awaitingHiddenRows", () => {
    // The status the list renders from: it must outlast the fetch trigger, or the empty state
    // appears the moment the request starts and disappears again when it lands.
    it("stays true while the top-up request is in flight", () => {
        expect(awaitingHiddenRows({visibleRows: 0, hasNextPage: true})).toBe(true)
        expect(
            shouldLoadMoreForHiddenRows({
                visibleRows: 0,
                hasNextPage: true,
                isFetchingNextPage: true,
            }),
        ).toBe(false)
    })

    it("ends the wait when the page fails, so the list stops hiding the empty state", () => {
        expect(awaitingHiddenRows({visibleRows: 0, hasNextPage: true, isError: true})).toBe(false)
    })

    it("is not waiting once a row shows, or at the last page", () => {
        expect(awaitingHiddenRows({visibleRows: 1, hasNextPage: true})).toBe(false)
        expect(awaitingHiddenRows({visibleRows: 0, hasNextPage: false})).toBe(false)
    })
})
