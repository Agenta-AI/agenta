/**
 * An MCP catalogue in the shape the permission drawer lists.
 *
 * The three strings a row needs are different strings, and the failures worth testing are the ones
 * where they get crossed: a policy keyed by a title nothing can look up, a write-capable tool
 * sorted into the read-only group because its server said nothing about it.
 */
import {describe, expect, it} from "vitest"

import {toCatalogTools} from "../../src/mcpEndpoint/core/toolCatalog"

describe("toCatalogTools", () => {
    it("keys every row by the name the server advertises", () => {
        // The key is what a saved permission is stored under. A row keyed by the title would
        // orphan every decision the author already made.
        expect(
            toCatalogTools([{name: "create_issue", title: "Create issue"}]).map((tool) => tool.key),
        ).toEqual(["create_issue"])
    })

    it("shows the title when the server offered one", () => {
        expect(toCatalogTools([{name: "create_issue", title: "Create issue"}])[0].name).toBe(
            "Create issue",
        )
    })

    it("falls back to the older annotations title, then to the name", () => {
        expect(
            toCatalogTools([{name: "create_issue", annotations: {title: "Create issue"}}])[0].name,
        ).toBe("Create issue")
        expect(toCatalogTools([{name: "create_issue"}])[0].name).toBe("create_issue")
    })

    it("puts a read-only tool in the read-only group", () => {
        expect(
            toCatalogTools([{name: "list_teams", annotations: {readOnlyHint: true}}])[0].readOnly,
        ).toBe(true)
    })

    it("leaves a tool the server said nothing about out of the read-only group", () => {
        // Absent stays absent rather than becoming false: `partitionToolsByAccess` sorts anything
        // that is not exactly `true` into write, and the unknown case belongs on that side.
        expect(toCatalogTools([{name: "create_issue"}])[0].readOnly).toBeUndefined()
        expect(
            toCatalogTools([{name: "create_issue", annotations: {destructiveHint: true}}])[0]
                .readOnly,
        ).toBeUndefined()
    })

    it("keeps a server's explicit false as an explicit false", () => {
        expect(
            toCatalogTools([{name: "create_issue", annotations: {readOnlyHint: false}}])[0]
                .readOnly,
        ).toBe(false)
    })

    it("carries the description a row shows and omits one that is absent", () => {
        expect(toCatalogTools([{name: "echo", description: "Echo it back"}])[0].description).toBe(
            "Echo it back",
        )
        expect("description" in toCatalogTools([{name: "echo"}])[0]).toBe(false)
    })

    it("marks nothing stale, because a catalogue is what the server advertises", () => {
        // Stale is a fact about a SAVED key, which this function is not given. The drawer adds
        // those rows from the policy with `withStaleTools`.
        expect(toCatalogTools([{name: "echo"}])[0].stale).toBeUndefined()
    })

    it("keeps the server's order", () => {
        expect(
            toCatalogTools([{name: "b"}, {name: "a"}, {name: "c"}]).map((tool) => tool.key),
        ).toEqual(["b", "a", "c"])
    })
})
