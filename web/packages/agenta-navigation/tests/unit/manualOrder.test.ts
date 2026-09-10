import {describe, expect, it} from "vitest"

import {
    applyManualOrder,
    applyManualOrderByActivity,
    capManualOrder,
    mergeManualOrder,
    movedManualOrder,
    withManualAgentRanks,
} from "../../src/reorder/applyOrder"
import {withRefsByRecency} from "../../src/dynamic/groups"
import type {SidebarEntityRef, SidebarEntitySource} from "../../src/dynamic/types"
import {SESSION_REORDER_ZONES} from "../../src/dynamic/sessionsSource"
import {
    SIDEBAR_AGENT_GROUP_ZONE,
    SIDEBAR_AGENT_ORDER_ZONE,
    SIDEBAR_STATUS_GROUP_ZONE,
} from "../../src/reorder/manualOrder"

const id = (row: {id: string}) => row.id
const rows = (...ids: string[]) => ids.map((value) => ({id: value}))
const ids = (list: {id: string}[]) => list.map((row) => row.id)

describe("applyManualOrder", () => {
    it("sorts arranged rows by their saved rank", () => {
        expect(ids(applyManualOrder(rows("a", "b", "c"), id, ["c", "a", "b"], "trail"))).toEqual([
            "c",
            "a",
            "b",
        ])
    })

    it("leads with rows the arrangement has not seen", () => {
        // A session you just started is the one you are about to use.
        expect(ids(applyManualOrder(rows("new", "a", "b"), id, ["b", "a"], "lead"))).toEqual([
            "new",
            "b",
            "a",
        ])
    })

    it("trails rows the arrangement has not seen", () => {
        // Arranging is how you promote an agent, so one you never placed must not displace it.
        expect(ids(applyManualOrder(rows("new", "a", "b"), id, ["b", "a"], "trail"))).toEqual([
            "b",
            "a",
            "new",
        ])
    })

    it("keeps the natural order when nothing is arranged", () => {
        expect(ids(applyManualOrder(rows("a", "b"), id, [], "lead"))).toEqual(["a", "b"])
    })

    it("keeps the natural order when the arrangement names none of these rows", () => {
        expect(ids(applyManualOrder(rows("a", "b"), id, ["x", "y"], "trail"))).toEqual(["a", "b"])
    })
})

describe("mergeManualOrder", () => {
    it("keeps a hidden id's slot while the visible ids rearrange around it", () => {
        // `b` is filtered out or past the row cap; it must not be dropped or moved.
        expect(mergeManualOrder(["a", "b", "c"], ["c", "a"])).toEqual(["c", "b", "a"])
    })

    it("leaves a longer arrangement intact when a filtered view writes a shorter one", () => {
        // Rows are filtered, windowed and capped before render, so a drop routinely sees a subset
        // of what has been arranged. A visible-only write would discard the rest.
        const saved = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10", "a11", "a12"]
        const merged = mergeManualOrder(saved, ["a5", "a1", "a2", "a3", "a4"])
        expect(merged).toHaveLength(12)
        expect(merged.slice(0, 5)).toEqual(["a5", "a1", "a2", "a3", "a4"])
        expect(merged.slice(5)).toEqual(saved.slice(5))
    })

    it("appends visible ids the arrangement has never seen", () => {
        expect(mergeManualOrder(["a", "b"], ["b", "a", "c"])).toEqual(["b", "a", "c"])
    })

    it("takes the visible order when nothing is saved", () => {
        expect(mergeManualOrder([], ["b", "a"])).toEqual(["b", "a"])
    })

    it("leaves the saved order alone when nothing is visible", () => {
        expect(mergeManualOrder(["a", "b"], [])).toEqual(["a", "b"])
    })
})

describe("withManualAgentRanks", () => {
    const counts = new Map([
        ["busy", 40],
        ["quiet", 1],
    ])

    it("lifts an arranged agent above every session count", () => {
        const ranks = withManualAgentRanks(counts, ["quiet"])
        expect(ranks.get("quiet")!).toBeGreaterThan(ranks.get("busy")!)
    })

    it("preserves the arranged order", () => {
        const ranks = withManualAgentRanks(counts, ["quiet", "busy"])
        expect(ranks.get("quiet")!).toBeGreaterThan(ranks.get("busy")!)
    })

    it("hands back the same map when nothing is arranged", () => {
        expect(withManualAgentRanks(counts, [])).toBe(counts)
    })

    it("puts arranged agents first through the real sorter", () => {
        // Composition, not the helper alone: a sign error in the rank base only shows up here.
        const source = {
            status: "ready",
            refs: [{id: "busy"}, {id: "quiet"}, {id: "unranked"}],
        } as SidebarEntitySource
        const ranks = withManualAgentRanks(counts, ["quiet"])
        const sorted = withRefsByRecency(source, (ref: SidebarEntityRef) => ranks.get(ref.id))
        expect(sorted.refs.map((ref) => ref.id)).toEqual(["quiet", "busy", "unranked"])
    })
})

describe("movedManualOrder", () => {
    it("swaps with the neighbour in that direction", () => {
        expect(movedManualOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"])
        expect(movedManualOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"])
    })

    it("refuses a move off either end", () => {
        expect(movedManualOrder(["a", "b"], "a", -1)).toBeNull()
        expect(movedManualOrder(["a", "b"], "b", 1)).toBeNull()
    })

    it("refuses an id the zone does not hold", () => {
        expect(movedManualOrder(["a", "b"], "z", 1)).toBeNull()
    })
})

describe("SESSION_REORDER_ZONES", () => {
    it("offers no zones under date or flat grouping", () => {
        // Those orders MEAN something — a calendar, an activity run — so overriding them would
        // make the heading lie.
        expect(SESSION_REORDER_ZONES.date).toBeUndefined()
        expect(SESSION_REORDER_ZONES.none).toBeUndefined()
    })

    it("arranges agent headings apart from the Agents nav group", () => {
        // The two agent lists answer different questions, so arranging one says nothing about
        // the other. Sharing a zone made a drag in the rail silently reorder the nav group.
        expect(SESSION_REORDER_ZONES.agent?.groupZone).toBe(SIDEBAR_AGENT_GROUP_ZONE)
        expect(SESSION_REORDER_ZONES.agent?.groupZone).not.toBe(SIDEBAR_AGENT_ORDER_ZONE)
    })

    it("leaves every heading that is not an agent out of the agent order", () => {
        // Pinned is a heading like any other. Slicing "agent:" off it yielded an EMPTY id, which
        // made it draggable and would have written "" into the agent order.
        const groupId = SESSION_REORDER_ZONES.agent?.groupId
        expect(groupId?.("pinned")).toBeUndefined()
        expect(groupId?.("agent:none")).toBeUndefined()
        expect(groupId?.("recent")).toBeUndefined()
    })

    it("leaves Pinned out of the status heading order", () => {
        const groupId = SESSION_REORDER_ZONES.status?.groupId
        expect(groupId?.("status:running")).toBe("status:running")
        expect(groupId?.("pinned")).toBeUndefined()
    })

    it("saves an agent heading under its heading key", () => {
        // Nothing else writes this zone, so the key needs no shape to agree with.
        expect(SESSION_REORDER_ZONES.agent?.groupId?.("agent:abc123")).toBe("agent:abc123")
    })

    it("keeps every zone it offers distinct from every other", () => {
        // One shared zone is how the Agents nav group and the Sessions headings ended up
        // reordering together.
        const zones = [
            SIDEBAR_AGENT_ORDER_ZONE,
            SESSION_REORDER_ZONES.agent?.groupZone,
            SESSION_REORDER_ZONES.status?.groupZone,
            SESSION_REORDER_ZONES.agent?.rowZone?.("agent:abc123"),
            SESSION_REORDER_ZONES.status?.rowZone?.("status:running"),
        ]
        expect(new Set(zones).size).toBe(zones.length)
    })

    it("gives each agent heading its own row zone, and none to pins or the unassigned bucket", () => {
        const rowZone = SESSION_REORDER_ZONES.agent?.rowZone
        expect(rowZone?.("agent:abc123")).toBe("sessions:agent:abc123")
        expect(rowZone?.("pinned")).toBeUndefined()
        expect(rowZone?.("agent:none")).toBeUndefined()
    })

    it("arranges status headings and their rows, but leaves pins alone", () => {
        expect(SESSION_REORDER_ZONES.status?.groupZone).toBe(SIDEBAR_STATUS_GROUP_ZONE)
        expect(SESSION_REORDER_ZONES.status?.rowZone?.("status:running")).toBe(
            "sessions:status:running",
        )
        expect(SESSION_REORDER_ZONES.status?.rowZone?.("pinned")).toBeUndefined()
    })
})

describe("capManualOrder", () => {
    const order = ["a", "b", "c", "d", "e"]

    it("returns the order untouched when it fits", () => {
        expect(capManualOrder(order, ["a"], 5)).toEqual(order)
    })

    // The bug this exists for: a blind slice drops whatever sits past the cap, which after paging
    // is a row on screen — and an unknown row then leads its bucket, reordering the list.
    it("evicts off-screen ids before any visible one", () => {
        // b and c are off screen and nearest the tail, so they go; a keeps its slot.
        expect(capManualOrder(order, ["d", "e"], 3)).toEqual(["a", "d", "e"])
    })

    it("never drops a visible id", () => {
        const capped = capManualOrder(order, ["c", "e"], 3)
        expect(capped).toContain("c")
        expect(capped).toContain("e")
    })

    it("falls back to trimming the tail when everything is visible", () => {
        expect(capManualOrder(order, order, 3)).toEqual(["a", "b", "c"])
    })
})

describe("applyManualOrderByActivity", () => {
    interface Row {
        id: string
        at: string | null
    }
    const idOf = (row: Row) => row.id
    const atOf = (row: Row) => row.at
    const arranged = ["b", "a"]

    it("sorts the arranged rows by the saved order", () => {
        const rows: Row[] = [
            {id: "a", at: "2026-09-02T00:00:00Z"},
            {id: "b", at: "2026-09-01T00:00:00Z"},
        ]
        expect(applyManualOrderByActivity(rows, idOf, atOf, arranged).map(idOf)).toEqual(["b", "a"])
    })

    it("leads an unseen row that is newer than everything arranged", () => {
        const rows: Row[] = [
            {id: "a", at: "2026-09-02T00:00:00Z"},
            {id: "b", at: "2026-09-01T00:00:00Z"},
            {id: "new", at: "2026-09-03T00:00:00Z"},
        ]
        expect(applyManualOrderByActivity(rows, idOf, atOf, arranged).map(idOf)).toEqual([
            "new",
            "b",
            "a",
        ])
    })

    // A later page is OLDER than the head. Leading it would hoist stale rows over the arrangement.
    it("trails the older rows a later page brings in", () => {
        const rows: Row[] = [
            {id: "a", at: "2026-09-02T00:00:00Z"},
            {id: "b", at: "2026-09-01T00:00:00Z"},
            {id: "old1", at: "2026-08-20T00:00:00Z"},
            {id: "old2", at: "2026-08-19T00:00:00Z"},
        ]
        expect(applyManualOrderByActivity(rows, idOf, atOf, arranged).map(idOf)).toEqual([
            "b",
            "a",
            "old1",
            "old2",
        ])
    })

    it("trails a row that cannot prove it is newer", () => {
        const rows: Row[] = [
            {id: "a", at: "2026-09-02T00:00:00Z"},
            {id: "b", at: "2026-09-01T00:00:00Z"},
            {id: "undated", at: null},
        ]
        expect(applyManualOrderByActivity(rows, idOf, atOf, arranged).map(idOf)).toEqual([
            "b",
            "a",
            "undated",
        ])
    })

    it("leaves the rows alone when nothing is arranged", () => {
        const rows: Row[] = [
            {id: "x", at: "2026-09-02T00:00:00Z"},
            {id: "y", at: "2026-09-01T00:00:00Z"},
        ]
        expect(applyManualOrderByActivity(rows, idOf, atOf, []).map(idOf)).toEqual(["x", "y"])
    })
})
