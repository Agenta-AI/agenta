import {describe, expect, it} from "vitest"

import {browseRows, parentPath, recentRows, searchRows} from "../../src/assets/filePaletteRows"

const file = (path: string, extra: Record<string, unknown> = {}) => ({path, ...extra})

const LISTING = [
    file("AGENTS.md", {size: 2300}),
    file("README.md", {size: 293}),
    file("audits/", {is_folder: true, item_count: 4}),
    file("audits/2026-08/slop-report.md", {size: 14000}),
    file("agent-files/notes.md", {size: 40}),
    file(".agenta-runner/state.json", {size: 1}),
]

describe("browseRows", () => {
    it("lists the root's own entries, folding deeper paths into their folder", () => {
        expect(browseRows(LISTING, "").map((r) => r.path)).toEqual([
            "agent-files",
            "audits",
            "AGENTS.md",
            "README.md",
        ])
    })

    it("scopes to a folder, and names rows by their basename", () => {
        expect(browseRows(LISTING, "audits")).toEqual([
            {path: "audits/2026-08", name: "2026-08", isFolder: true},
        ])
    })

    it("drops runner plumbing", () => {
        expect(browseRows(LISTING, "").some((r) => r.path.startsWith(".agenta"))).toBe(false)
    })

    it("keeps a folder's own count off an implied folder", () => {
        expect(browseRows(LISTING, "").find((r) => r.path === "audits")?.itemCount).toBe(4)
    })
})

describe("searchRows", () => {
    it("matches anywhere in the path", () => {
        expect(searchRows(LISTING, "", "report").map((r) => r.path)).toEqual([
            "audits/2026-08/slop-report.md",
        ])
    })

    it("puts folders above the files that match the same term", () => {
        expect(searchRows(LISTING, "", "audits").map((r) => r.path)).toEqual([
            "audits",
            "audits/2026-08/slop-report.md",
        ])
    })

    it("scopes to the folder in view", () => {
        expect(searchRows(LISTING, "audits", "md").map((r) => r.path)).toEqual([
            "audits/2026-08/slop-report.md",
        ])
        expect(searchRows(LISTING, "audits", "AGENTS")).toEqual([])
    })

    it("reaches the agent mount through its fold prefix", () => {
        expect(searchRows(LISTING, "", "notes").map((r) => r.path)).toEqual([
            "agent-files/notes.md",
        ])
    })

    it("caps the result set", () => {
        const many = Array.from({length: 80}, (_, i) => file(`docs/page-${i}.md`))
        expect(searchRows(many, "", "page", 30)).toHaveLength(30)
    })

    it("returns nothing for a blank query", () => {
        expect(searchRows(LISTING, "", "  ")).toEqual([])
    })
})

describe("recentRows", () => {
    it("keeps order, drops folders, and honours the limit", () => {
        const recents = [
            file("audits/2026-08/slop-report.md", {touchedAt: 3}),
            file("audits/", {is_folder: true}),
            file("README.md", {touchedAt: 2}),
            // A third eligible row, so an ignored limit would show up here.
            file("AGENTS.md", {touchedAt: 1}),
        ]
        expect(recentRows(recents, 2).map((r) => r.path)).toEqual([
            "audits/2026-08/slop-report.md",
            "README.md",
        ])
    })
})

describe("parentPath", () => {
    it("walks one level, and stops at the root", () => {
        expect(parentPath("audits/2026-08/x.md")).toBe("audits/2026-08")
        expect(parentPath("audits")).toBe("")
    })
})
