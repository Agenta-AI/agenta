import {describe, expect, it} from "vitest"

import {
    ALL_OWNERS,
    DEFAULT_AGENT_LIST_VIEW,
    deriveAgentList,
    isDefaultAgentFilters,
    isDefaultAgentListView,
    lastActiveLabel,
    type AgentListRow,
    type AgentListView,
} from "../../src/features/agents/agentListView"

const NOW = new Date("2026-09-10T12:00:00Z").getTime()
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString()

const row = (
    id: string,
    {
        updatedAt = daysAgo(1),
        createdById = "u1",
        ownerName = "You",
        waiting = 0,
    }: {
        updatedAt?: string | null
        createdById?: string | null
        ownerName?: string
        waiting?: number
    } = {},
): AgentListRow => ({id, name: id, description: null, updatedAt, ownerName, createdById, waiting})

const view = (patch: Partial<AgentListView> = {}): AgentListView => ({
    ...DEFAULT_AGENT_LIST_VIEW,
    ...patch,
})

const labels = (groups: {label: string | null}[]) => groups.map((group) => group.label)
const ids = (groups: {rows: AgentListRow[]}[]) =>
    groups.flatMap((group) => group.rows.map((r) => r.id))

describe("isDefaultAgentListView", () => {
    it("counts the grouping as non-default, but not as a filter", () => {
        expect(isDefaultAgentListView(view({group: "activity"}))).toBe(false)
        expect(isDefaultAgentFilters(view({group: "activity"}))).toBe(true)
    })

    it("counts a narrowed creator or a swapped roster", () => {
        expect(isDefaultAgentFilters(view({owner: "u2"}))).toBe(false)
        expect(isDefaultAgentFilters(view({type: "archived"}))).toBe(false)
        expect(isDefaultAgentFilters(view({status: "waiting"}))).toBe(false)
    })
})

describe("deriveAgentList — filtering", () => {
    // `type` is not a predicate here: the screen fetches ONE roster, so every row already
    // matches it by the time it arrives.
    const rows = [row("mine", {createdById: "u1"}), row("theirs", {createdById: "u2"})]

    it("narrows to one creator, and `all` keeps everyone", () => {
        expect(ids(deriveAgentList(rows, view({owner: "u1"}), NOW))).toEqual(["mine"])
        expect(ids(deriveAgentList(rows, view({owner: ALL_OWNERS}), NOW))).toHaveLength(2)
    })

    it("narrows to the agents holding something for a person", () => {
        const waiting = [row("busy", {waiting: 2}), row("quiet")]
        expect(ids(deriveAgentList(waiting, view({status: "waiting"}), NOW))).toEqual(["busy"])
        expect(ids(deriveAgentList(waiting, view({status: "idle"}), NOW))).toEqual(["quiet"])
        expect(ids(deriveAgentList(waiting, view(), NOW))).toEqual(["busy", "quiet"])
    })
})

describe("deriveAgentList — grouping", () => {
    it("draws no heading at all when grouping is off", () => {
        expect(labels(deriveAgentList([row("a")], view(), NOW))).toEqual([null])
    })

    it("orders the activity buckets newest-first and drops empty ones", () => {
        const rows = [
            row("old", {updatedAt: daysAgo(90)}),
            row("recent", {updatedAt: daysAgo(2)}),
            row("mid", {updatedAt: daysAgo(20)}),
        ]
        const groups = deriveAgentList(rows, view({group: "activity"}), NOW)
        expect(labels(groups)).toEqual(["This week", "This month", "Older"])
        expect(ids(groups)).toEqual(["recent", "mid", "old"])
    })

    it("buckets a row with no timestamp as Older rather than as brand new", () => {
        const groups = deriveAgentList(
            [row("undated", {updatedAt: null})],
            view({group: "activity"}),
            NOW,
        )
        expect(labels(groups)).toEqual(["Older"])
    })

    it("puts the agents holding something for a person above the quiet ones", () => {
        const rows = [row("quiet"), row("busy", {waiting: 1})]
        const groups = deriveAgentList(rows, view({group: "status"}), NOW)
        expect(labels(groups)).toEqual(["Waiting", "Idle"])
        expect(ids(groups)).toEqual(["busy", "quiet"])
    })

    it("names creator headings, and falls back for a creator it cannot name", () => {
        const rows = [row("mine", {ownerName: "You"}), row("theirs", {ownerName: ""})]
        expect(labels(deriveAgentList(rows, view({group: "owner"}), NOW))).toEqual([
            "Unknown",
            "You",
        ])
    })
})

describe("lastActiveLabel", () => {
    it("reads as an em dash when an agent has no timestamp", () => {
        expect(lastActiveLabel(null)).toBe("—")
    })
})
