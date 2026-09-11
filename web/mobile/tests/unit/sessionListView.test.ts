import {sessionRowStatusMeta, type SessionRowStatus, type SessionRowVm} from "@agenta/sessions/row"
import {describe, expect, it} from "vitest"

import {
    activityFloorIso,
    DEFAULT_SESSION_LIST_VIEW,
    deriveSessionGroups,
    isDefaultSessionListView,
} from "../../src/features/sessions/sessionListView"

/** Midday, so a "yesterday" row an hour either side of midnight still lands in its calendar day. */
const NOW = new Date("2026-09-10T12:00:00Z").getTime()

const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString()

const row = (
    id: string,
    {
        activityAt = hoursAgo(1),
        agentId = null,
        status = "idle" as SessionRowStatus,
    }: {activityAt?: string | null; agentId?: string | null; status?: SessionRowStatus} = {},
): SessionRowVm =>
    ({
        id,
        title: id,
        subtitle: null,
        status: sessionRowStatusMeta(status),
        pending: undefined,
        agentId,
        activityAt,
        isAutomation: false,
        automation: null,
        deliveryId: null,
        isPinned: false,
        // Nothing under test reads the wire row.
        stream: {} as SessionRowVm["stream"],
    }) satisfies SessionRowVm

const labels = (groups: {label: string | null}[]) => groups.map((group) => group.label)
const keys = (groups: {rows: SessionRowVm[]}[]) =>
    groups.map((group) => group.rows.map((r) => r.id))

describe("deriveSessionGroups", () => {
    it("draws no heading and one run when grouping is off", () => {
        const groups = deriveSessionGroups([row("a"), row("b")], "none", new Map(), NOW)
        expect(groups).toHaveLength(1)
        expect(groups[0]?.label).toBeNull()
        expect(keys(groups)).toEqual([["a", "b"]])
    })

    it("returns nothing rather than an empty run when there are no rows", () => {
        expect(deriveSessionGroups([], "none", new Map(), NOW)).toEqual([])
        expect(deriveSessionGroups([], "agent", new Map(), NOW)).toEqual([])
    })

    it("buckets by calendar day, oldest bucket last", () => {
        const groups = deriveSessionGroups(
            [
                row("older", {activityAt: hoursAgo(24 * 30)}),
                row("today", {activityAt: hoursAgo(2)}),
                row("week", {activityAt: hoursAgo(24 * 4)}),
                row("yesterday", {activityAt: hoursAgo(24)}),
            ],
            "date",
            new Map(),
            NOW,
        )
        expect(labels(groups)).toEqual(["Today", "Yesterday", "This week", "Older"])
    })

    it("reads yesterday as the calendar day, not as 24 hours", () => {
        // An hour before LOCAL midnight — under a day old, but the previous calendar day, which
        // is what a reader means by "yesterday" and what a naive 24-hour cutoff calls "today".
        // Derived from the local day rather than a fixed offset, so the test does not assume the
        // runner's timezone.
        const localMidnight = new Date(NOW)
        localMidnight.setHours(0, 0, 0, 0)
        const lateYesterday = new Date(localMidnight.getTime() - 3_600_000).toISOString()

        const groups = deriveSessionGroups(
            [row("a", {activityAt: lateYesterday})],
            "date",
            new Map(),
            NOW,
        )
        expect(labels(groups)).toEqual(["Yesterday"])
    })

    it("puts a row with no activity timestamp in Older", () => {
        const groups = deriveSessionGroups([row("a", {activityAt: null})], "date", new Map(), NOW)
        expect(labels(groups)).toEqual(["Older"])
    })

    it("orders status groups by what costs you most to miss", () => {
        const groups = deriveSessionGroups(
            [
                row("ended", {status: "ended"}),
                row("idle", {status: "idle"}),
                row("waiting", {status: "waiting"}),
                row("running", {status: "running"}),
            ],
            "status",
            new Map(),
            NOW,
        )
        expect(labels(groups)).toEqual(["Waiting on you", "Running", "Idle", "Ended"])
    })

    it("names agent groups from the roster and keeps first-appearance order", () => {
        const groups = deriveSessionGroups(
            [row("a", {agentId: "w2"}), row("b", {agentId: "w1"}), row("c", {agentId: "w2"})],
            "agent",
            new Map([
                ["w1", "Teach me"],
                ["w2", "Agent Builder"],
            ]),
            NOW,
        )
        expect(labels(groups)).toEqual(["Agent Builder", "Teach me"])
        expect(keys(groups)).toEqual([["a", "c"], ["b"]])
    })

    it("tells an agent the roster does not name apart from a session that has none", () => {
        const groups = deriveSessionGroups(
            [row("a", {agentId: "gone"}), row("b", {agentId: null})],
            "agent",
            new Map(),
            NOW,
        )
        expect(labels(groups)).toEqual(["Unknown agent", "No agent yet"])
    })
})

describe("isDefaultSessionListView", () => {
    it("groups by agent over the last seven days by default", () => {
        expect(DEFAULT_SESSION_LIST_VIEW).toEqual({group: "agent", activity: "7d"})
        expect(isDefaultSessionListView(DEFAULT_SESSION_LIST_VIEW)).toBe(true)
        expect(isDefaultSessionListView({group: "date", activity: "7d"})).toBe(false)
        expect(isDefaultSessionListView({group: "agent", activity: "all"})).toBe(false)
    })
})

describe("activityFloorIso", () => {
    it("has no bound under All", () => {
        expect(activityFloorIso("all", NOW)).toBeUndefined()
    })

    it("counts back from the hour, so the value is stable between renders", () => {
        // Two instants inside the same hour must produce the same floor, or every render would
        // mint a new query key.
        expect(activityFloorIso("24h", NOW)).toBe(activityFloorIso("24h", NOW + 59 * 60_000))
        expect(Date.parse(activityFloorIso("24h", NOW)!)).toBe(NOW - 24 * 3_600_000)
        expect(Date.parse(activityFloorIso("7d", NOW)!)).toBe(NOW - 7 * 24 * 3_600_000)
        expect(Date.parse(activityFloorIso("30d", NOW)!)).toBe(NOW - 30 * 24 * 3_600_000)
    })
})
