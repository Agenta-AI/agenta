import {sessionRowStatusMeta, type SessionRowStatus, type SessionRowVm} from "@agenta/sessions/row"
import {describe, expect, it} from "vitest"

import {
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
        // 13 hours back from midday is 23:00 the previous day — the same clock day boundary a
        // reader means by "yesterday", and the case a naive 24-hour cutoff calls "today".
        const groups = deriveSessionGroups([row("a", {activityAt: hoursAgo(13)})], "date", new Map(), NOW)
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
    it("groups by agent by default", () => {
        expect(DEFAULT_SESSION_LIST_VIEW.group).toBe("agent")
        expect(isDefaultSessionListView(DEFAULT_SESSION_LIST_VIEW)).toBe(true)
        expect(isDefaultSessionListView({group: "date"})).toBe(false)
    })
})
