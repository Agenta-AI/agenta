import {createElement} from "react"

import {
    defineSidebarEntity,
    sidebarSessionGroup,
    type SessionSidebarRef,
    type SidebarEntity,
    type SidebarEntityRef,
    type SidebarEntitySource,
} from "@agenta/navigation"
import {describe, expect, it} from "vitest"

import {resolveChildren} from "./useSidebarDynamicChildren"

const ref = (id: string, name: string): SidebarEntityRef => ({id, name})

const entity = (overrides: Partial<SidebarEntity> = {}): SidebarEntity => ({
    parentKey: "project-sessions-link",
    kind: "app",
    activeSourceAtom: null as unknown as SidebarEntity["activeSourceAtom"],
    getLabel: (r) => r.name ?? r.id,
    childLink: (r) => `/apps/${r.id}/playground`,
    icon: createElement("span"),
    maxItems: 14,
    ...overrides,
})

const ready = (
    refs: SidebarEntityRef[],
    extra: Partial<SidebarEntitySource> = {},
): SidebarEntitySource => ({status: "ready", refs, ...extra})

describe("resolveChildren", () => {
    it("carries the entity's tooltip onto each row", () => {
        const children = resolveChildren(
            entity({getTooltip: (r) => (r.id === "s1" ? "Arabic Poetry Scheduler" : undefined)}),
            ready([ref("s1", "Morning poem"), ref("s2", "Untitled session")]),
            "/w/w1/p/p1",
        )

        expect(children.map((child) => child.tooltip)).toEqual([
            "Arabic Poetry Scheduler",
            undefined,
        ])
    })

    // A row whose agent hasn't resolved must not fall back to repeating its own label.
    it("leaves the tooltip unset when the entity declares none", () => {
        const children = resolveChildren(entity(), ready([ref("s1", "Morning poem")]), "/w/w1/p/p1")

        expect(children[0].tooltip).toBeUndefined()
    })

    it("renders up to maxItems rows and adds Show all beyond it", () => {
        const refs = Array.from({length: 20}, (_, index) => ref(`s${index}`, `Session ${index}`))
        const children = resolveChildren(
            entity({showAllLink: (projectURL) => `${projectURL}/sessions`}),
            ready(refs),
            "/w/w1/p/p1",
        )

        expect(children).toHaveLength(15)
        expect(children.at(-1)?.title).toBe("Show all")
    })
})

// `defineSidebarEntity` used to drop these silently: declared on the config type, consumed by
// `resolveChildren`, never forwarded — invisible because the tests above build a SidebarEntity by
// hand. Go through the factory so a regression fails here.
describe("defineSidebarEntity", () => {
    const built = defineSidebarEntity("main", "project-sessions-link", {
        kind: "app",
        listAtom: null as never,
        getLabel: (r: SidebarEntityRef) => r.name ?? r.id,
        childPath: (r: SidebarEntityRef) => `/apps/${r.id}/playground`,
        childMatchPaths: (r: SidebarEntityRef) => [`/apps/${r.id}`],
        getTooltip: () => "Ops Assistant",
        wrapRow: (_r, node) => createElement("span", null, node),
        getGroupKey: (r: SidebarEntityRef) => `agent:${r.id}`,
    })

    it("forwards the row seams onto the resolved entity", () => {
        expect(built.getTooltip?.(ref("s1", "Morning poem"))).toBe("Ops Assistant")
        expect(built.wrapRow).toBeTypeOf("function")
        expect(built.getGroupKey?.(ref("s1", "Morning poem"))).toBe("agent:s1")
        expect(built.childMatchLinks?.(ref("s1", "Morning poem"), "/w/w1/p/p1")).toEqual([
            "/w/w1/p/p1/apps/s1",
        ])
    })
})

describe("resolveChildren grouping", () => {
    const grouped = entity({getGroupKey: (r) => (r.id === "s1" ? "pinned" : "agent:a1")})
    const groups = [
        {key: "pinned", label: "Pinned"},
        {key: "agent:a1", label: "Ops Assistant"},
    ]
    const refs = [ref("s1", "Morning poem"), ref("s2", "Daily update"), ref("s3", "Docs audit")]

    it("interleaves a heading before each group's rows", () => {
        const children = resolveChildren(grouped, ready(refs, {groups}), "/w/w1/p/p1")

        expect(children.map((child) => [child.title, Boolean(child.isGroupLabel)])).toEqual([
            ["Pinned", true],
            ["Morning poem", false],
            ["Ops Assistant", true],
            ["Daily update", false],
            ["Docs audit", false],
        ])
    })

    it("keeps a collapsed group's heading but drops its rows", () => {
        const children = resolveChildren(
            grouped,
            ready(refs, {groups, collapsedKeys: ["agent:a1"]}),
            "/w/w1/p/p1",
        )

        expect(children.map((child) => child.title)).toEqual([
            "Pinned",
            "Morning poem",
            "Ops Assistant",
        ])
        expect(children.at(-1)?.isCollapsed).toBe(true)
    })

    // The cap is every entity's contract; a grouped list must not quietly render more.
    it("caps rows before grouping and drops headings left with none", () => {
        const many = Array.from({length: 20}, (_, i) => ref(`s${i}`, `Session ${i}`))
        const children = resolveChildren(
            entity({maxItems: 2, getGroupKey: (r) => (r.id === "s0" ? "pinned" : "agent:a1")}),
            ready(many, {groups: [...groups, {key: "agent:a2", label: "Release Bot"}]}),
            "/w/w1/p/p1",
        )

        expect(children.filter((child) => !child.isGroupLabel)).toHaveLength(2)
        expect(children.map((child) => child.title)).not.toContain("Release Bot")
    })

    it("prefers the source's empty label over the entity's", () => {
        const children = resolveChildren(
            entity({emptyLabel: "No sessions"}),
            ready([], {emptyLabel: "No sessions match these filters"}),
            "/w/w1/p/p1",
        )

        expect(children.map((child) => child.title)).toEqual(["No sessions match these filters"])
    })

    // Prompts and Agents share this resolver and set none of the new seams.
    it("leaves an ungrouped entity's children untouched", () => {
        const children = resolveChildren(entity(), ready(refs), "/w/w1/p/p1")

        expect(children.every((child) => !child.isGroupLabel)).toBe(true)
        expect(children.every((child) => child.wrapRow === undefined)).toBe(true)
        expect(children.map((child) => child.title)).toEqual([
            "Morning poem",
            "Daily update",
            "Docs audit",
        ])
    })
})

// The bucket is stamped onto the ROW upstream (an entity's getGroupKey closure is not reactive,
// so a groupBy change would not re-bucket). A silent regression here collapses every row into one
// heading — which is exactly what shipped once.
describe("sidebarSessionGroup", () => {
    // LOCAL noon, not UTC: the date buckets are local calendar days, so a UTC anchor would put
    // "today" on a different date for runners far enough east or west.
    const NOW = new Date(2026, 7, 21, 12, 0, 0).getTime()
    const row = (over: Partial<SessionSidebarRef> = {}): SessionSidebarRef => ({
        id: "s1",
        sessionId: "s1",
        appId: "a1",
        agentId: "a1",
        agentName: "Ops Assistant",
        pinned: false,
        alive: false,
        running: false,
        ...over,
    })

    it("buckets by the owning agent's name", () => {
        expect(sidebarSessionGroup(row(), "agent", NOW)).toEqual({
            key: "agent:a1",
            label: "Ops Assistant",
        })
    })

    it("falls back to a readable label when the agent name resolves empty", () => {
        expect(sidebarSessionGroup(row({agentName: "  "}), "agent", NOW).label).toBe("Agent")
    })

    it("labels a session with no agent yet", () => {
        expect(sidebarSessionGroup(row({agentId: null}), "agent", NOW)).toEqual({
            key: "agent:none",
            label: "No agent yet",
        })
    })

    it("puts pins in their own heading whichever grouping is active", () => {
        for (const groupBy of ["agent", "date", "status", "pinned"] as const) {
            expect(sidebarSessionGroup(row({pinned: true}), groupBy, NOW)).toEqual({
                key: "pinned",
                label: "Pinned",
            })
        }
    })

    // Local-noon timestamps: a midnight-adjacent one would land on a different calendar day
    // depending on the runner's timezone, and the bucket is a LOCAL day by design.
    const noon = (year: number, month: number, day: number) =>
        new Date(year, month - 1, day, 12, 0, 0).toISOString()

    it("names each day by its date, keeping words only for today and yesterday", () => {
        const at = (iso: string) => sidebarSessionGroup(row({activityAt: iso}), "date", NOW).label
        expect(at(noon(2026, 8, 21))).toBe("Today")
        expect(at(noon(2026, 8, 20))).toBe("Yesterday")
        expect(at(noon(2026, 8, 17))).toBe("Aug 17")
        expect(at(noon(2026, 7, 1))).toBe("Jul 1")
        // Past years say so; this is the only place the year earns its space.
        expect(at(noon(2025, 12, 24))).toBe("Dec 24, 2025")
        expect(sidebarSessionGroup(row(), "date", NOW).label).toBe("No activity")
    })

    it("keeps the same date in different years apart", () => {
        const key = (iso: string) => sidebarSessionGroup(row({activityAt: iso}), "date", NOW).key
        expect(key(noon(2026, 3, 4))).not.toBe(key(noon(2025, 3, 4)))
    })

    it("buckets by liveness", () => {
        const label = (over: Partial<SessionSidebarRef>) =>
            sidebarSessionGroup(row(over), "status", NOW).label
        expect(label({running: true})).toBe("Running")
        expect(label({alive: true})).toBe("Live")
        expect(label({})).toBe("Idle")
    })

    it("splits pinned from the rest", () => {
        expect(sidebarSessionGroup(row(), "pinned", NOW)).toEqual({key: "recent", label: "Recent"})
    })
})
