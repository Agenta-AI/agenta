import {createElement} from "react"

import {describe, expect, it} from "vitest"

import {
    defineSidebarEntity,
    groupingStartsFolded,
    localSessionRefsMatching,
    resolveChildren,
    sidebarSessionGroup,
    withRefsByRecency,
    type SessionSidebarRef,
    type SidebarEntity,
    type SidebarSessionFilters,
    type SidebarSessionGroupBy,
    type SidebarEntityRef,
    type SidebarEntitySource,
} from "../../src"

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

    // The "Group by: None" regression: the source emitted only the groups it wanted headings for,
    // and every row whose key was left out silently vanished — the rail showed pins and nothing
    // else. An entity that groups must either declare a group for every row it renders, or
    // declare none and fall through to the flat list.
    it("renders every row flat when the source declares no groups", () => {
        const children = resolveChildren(grouped, ready(refs, {groups: []}), "/w/w1/p/p1")

        expect(children.map((child) => child.title)).toEqual([
            "Morning poem",
            "Daily update",
            "Docs audit",
        ])
        expect(children.some((child) => child.isGroupLabel)).toBe(false)
    })

    it("drops rows whose group the source never declared", () => {
        const children = resolveChildren(
            grouped,
            ready(refs, {groups: [{key: "pinned", label: "Pinned"}]}),
            "/w/w1/p/p1",
        )

        expect(children.map((child) => child.title)).toEqual(["Pinned", "Morning poem"])
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
        archived: false,
        ...over,
    })

    it("buckets by the owning agent's name", () => {
        expect(sidebarSessionGroup(row(), "agent", NOW)).toMatchObject({
            key: "agent:a1",
            label: "Ops Assistant",
        })
    })

    it("falls back to a readable label when the agent name resolves empty", () => {
        expect(sidebarSessionGroup(row({agentName: "  "}), "agent", NOW).label).toBe("Agent")
    })

    it("labels a session with no agent yet", () => {
        expect(sidebarSessionGroup(row({agentId: null}), "agent", NOW)).toMatchObject({
            key: "agent:none",
            label: "No agent yet",
        })
    })

    it("puts pins in their own heading whichever grouping is active", () => {
        for (const groupBy of ["agent", "date", "status", "pinned"] as const) {
            expect(sidebarSessionGroup(row({pinned: true}), groupBy, NOW)).toMatchObject({
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

    it("puts every unpinned row under Recent when nothing groups them", () => {
        expect(sidebarSessionGroup(row(), "none", NOW)).toMatchObject({
            key: "recent",
            label: "Recent",
        })
    })

    // "Pinned first" was retired: pins lead under every grouping, so it grouped by nothing. A
    // stored value from before that is not a grouping the menu can show OR the grouper knows.
    it("pins lead whichever grouping is active", () => {
        expect(sidebarSessionGroup(row({pinned: true}), "none", NOW)).toMatchObject({
            key: "pinned",
            label: "Pinned",
        })
        expect(sidebarSessionGroup(row({pinned: true, agentId: "a1"}), "agent", NOW)).toMatchObject({
            key: "pinned",
            label: "Pinned",
        })
    })

    // The headings are sorted on this rank. Working in a session reorders the ROWS, and used to
    // reorder the sections with them, because the headings followed the rows' own order.
    describe("rank", () => {
        const rank = (over: Partial<SessionSidebarRef>, groupBy: SidebarSessionGroupBy) =>
            sidebarSessionGroup(row(over), groupBy, NOW).rank

        it("sorts pins below everything, under every grouping", () => {
            for (const groupBy of ["none", "agent", "date", "status"] as const) {
                expect(rank({pinned: true}, groupBy)).toBeLessThan(rank({}, groupBy))
            }
        })

        it("sorts the newest day first and no-activity last", () => {
            const at = (iso?: string) => rank({activityAt: iso}, "date")
            expect(at(noon(2026, 8, 21))).toBeLessThan(at(noon(2026, 8, 20)))
            expect(at(noon(2026, 8, 20))).toBeLessThan(at(noon(2025, 12, 24)))
            expect(at()).toBeGreaterThan(at(noon(2026, 8, 21)))
        })

        it("sorts liveness Running, Live, Idle", () => {
            expect(rank({running: true}, "status")).toBeLessThan(rank({alive: true}, "status"))
            expect(rank({alive: true}, "status")).toBeLessThan(rank({}, "status"))
        })

        // Agents tie on rank and are separated by name; only the unassigned heading is pushed past.
        it("sorts named agents together, ahead of No agent yet", () => {
            expect(rank({agentId: "a2"}, "agent")).toBe(rank({agentId: "a1"}, "agent"))
            expect(rank({agentId: "a1"}, "agent")).toBeLessThan(rank({agentId: null}, "agent"))
        })
    })
})

// An ordering regression is silent — the list still renders, just wrong — so the rules that make
// it predictable (newest first, unranked last, ties untouched) are pinned here.
describe("withRefsByRecency", () => {
    const source = (ids: string[]): SidebarEntitySource => ({
        status: "ready",
        refs: ids.map((id) => ({id, name: id})),
    })
    const order = (result: SidebarEntitySource) => result.refs.map((entry) => entry.id)

    it("puts the most recently used first", () => {
        const ranks: Record<string, number> = {a: 10, b: 30, c: 20}
        expect(order(withRefsByRecency(source(["a", "b", "c"]), (r) => ranks[r.id]))).toEqual([
            "b",
            "c",
            "a",
        ])
    })

    it("keeps unranked rows in their own order, behind every ranked one", () => {
        const ranks: Record<string, number> = {b: 5}
        expect(order(withRefsByRecency(source(["a", "b", "c", "d"]), (r) => ranks[r.id]))).toEqual([
            "b",
            "a",
            "c",
            "d",
        ])
    })

    it("is stable across equal ranks", () => {
        expect(order(withRefsByRecency(source(["a", "b", "c"]), () => 7))).toEqual(["a", "b", "c"])
    })

    // Identity matters: the nav items memo keys on the source, so a re-sort that changed nothing
    // would rebuild the whole rail.
    it("returns the SAME source when the order already holds", () => {
        const input = source(["a", "b"])
        const ranks: Record<string, number> = {a: 2, b: 1}
        expect(withRefsByRecency(input, (r) => ranks[r.id])).toBe(input)
    })

    it("leaves a source that is not ready alone", () => {
        const loading: SidebarEntitySource = {status: "loading", refs: []}
        expect(withRefsByRecency(loading, () => 1)).toBe(loading)
    })
})

// A grouping change must not read as "everything collapsed": the stored set flips a heading away
// from its default rather than listing open ones, so its keys survive a regrouping.
describe("groupingStartsFolded", () => {
    it("starts every grouping open", () => {
        for (const groupBy of ["agent", "date", "status", "pinned"] as const) {
            expect(groupingStartsFolded(groupBy)).toBe(false)
        }
    })
})


// The rail's filters are server predicates, and a host-contributed row never went through the
// query — so each one has to be re-applied here or the row survives a filter that hid its peers.
describe("localSessionRefsMatching", () => {
    const local = (over: Partial<SessionSidebarRef> = {}): SessionSidebarRef => ({
        id: over.id ?? "local",
        sessionId: over.id ?? "local",
        appId: "a1",
        agentId: "a1",
        pinned: false,
        alive: false,
        running: false,
        archived: false,
        ...over,
    })

    const filters = (over: Partial<SidebarSessionFilters> = {}): SidebarSessionFilters => ({
        groupBy: "none",
        agentIds: [],
        status: "all",
        activity: "7d",
        type: "chat",
        ...over,
    })

    const ids = (rows: SessionSidebarRef[]) => rows.map((row) => row.id)
    const NONE: ReadonlySet<string> = new Set()

    it("keeps every row when nothing is filtered", () => {
        expect(ids(localSessionRefsMatching([local()], filters(), NONE))).toEqual(["local"])
    })

    // A client-created chat is never a trigger run, so Automation must not list one.
    it("drops every local row under Automation", () => {
        expect(localSessionRefsMatching([local()], filters({type: "automation"}), NONE)).toEqual([])
    })

    it("keeps local rows when both types are listed", () => {
        expect(ids(localSessionRefsMatching([local()], filters({type: "all"}), NONE))).toEqual([
            "local",
        ])
    })

    it("drops a row belonging to an agent the filter excludes", () => {
        const rows = [local({id: "mine"}), local({id: "theirs", agentId: "a2"})]

        expect(ids(localSessionRefsMatching(rows, filters({agentIds: ["a1"]}), NONE))).toEqual([
            "mine",
        ])
    })

    it("applies the liveness facet", () => {
        const running = local({id: "running", running: true})
        const idle = local({id: "idle"})
        const rows = [running, idle]

        expect(ids(localSessionRefsMatching(rows, filters({status: "running"}), NONE))).toEqual([
            "running",
        ])
        expect(ids(localSessionRefsMatching(rows, filters({status: "idle"}), NONE))).toEqual([
            "idle",
        ])
    })

    // The host knows a gate is open before the interactions query has a row for it.
    it("honours a gate the row reports itself", () => {
        const rows = [local({id: "gated", waiting: true})]

        expect(ids(localSessionRefsMatching(rows, filters({status: "waiting"}), NONE))).toEqual([
            "gated",
        ])
        expect(localSessionRefsMatching(rows, filters({status: "idle"}), NONE)).toEqual([])
    })

    // A gate ranks above liveness, the same rule the server rows follow.
    it("counts a gated row as awaiting input, not idle", () => {
        const rows = [local({id: "gated"})]
        const gated: ReadonlySet<string> = new Set(["gated"])

        expect(ids(localSessionRefsMatching(rows, filters({status: "waiting"}), gated))).toEqual([
            "gated",
        ])
        expect(localSessionRefsMatching(rows, filters({status: "idle"}), gated)).toEqual([])
    })
})
